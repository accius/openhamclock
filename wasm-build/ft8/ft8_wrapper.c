/*
 * ft8_wrapper.c — a one-call FT8 decoder around kgoba/ft8_lib (MIT) for
 * OpenHamClock's in-browser Decoder panel.
 *
 *   char *ft8_decode(const float *pcm, int num_samples, int sample_rate,
 *                    float f_min, float f_max);
 *       pcm          one 15 s FT8 slot of mono audio, -1..+1, starting at the
 *                    slot boundary (12 kHz expected; other rates work but
 *                    cost time)
 *       returns      a malloc'd NUL-terminated JSON array
 *                      [{"snr":-12,"dt":0.3,"freq":1234,"text":"CQ K1ABC FN42"}, …]
 *                    which the caller MUST release with ft8_free().
 *                    NULL only if memory runs out.
 *
 *   void ft8_free(void *p);      free a result
 *   void ft8_reset(void);        forget hashed callsigns (e.g. on band change)
 *
 * Every allocation made by ft8_decode() (the monitor/waterfall and its FFT
 * work areas) is released before it returns; only the returned string and the
 * small fixed-size callsign hash table (needed to resolve <hashed> calls in
 * later slots) outlive the call.
 *
 * SNR: ft8_lib only reports a sync score. We re-encode each decoded message
 * to its 79 tones and compare the power in the expected tone against the
 * waterfall's median power per bin, mapped to WSJT-X's 2500 Hz-bandwidth dB
 * scale by a fit against WSJT-X (see SNR_SLOPE below and README.md).
 *
 * dt: seconds relative to the nominal FT8 start 0.5 s into the slot, like
 * WSJT-X's DT column.
 */
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <common/monitor.h>
#include <ft8/constants.h>
#include <ft8/decode.h>
#include <ft8/encode.h>
#include <ft8/message.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define FT8_API EMSCRIPTEN_KEEPALIVE
#else
#define FT8_API
#endif

/*
 * Decoder search settings (overridable with -D for tuning). Chosen by a sweep
 * over ft8_lib's test WAVs against WSJT-X (wasm-build/ft8/README.md): more
 * candidates, a lower sync threshold or more LDPC iterations found nothing
 * new; 4x time oversampling and a second masked pass did (71.5 % → 76.0 %).
 */
#ifndef MIN_SCORE
#define MIN_SCORE 10
#endif
#ifndef MAX_CANDIDATES
#define MAX_CANDIDATES 300
#endif
#ifndef LDPC_ITERATIONS
#define LDPC_ITERATIONS 25
#endif
#ifndef FREQ_OSR
#define FREQ_OSR 2
#endif
#ifndef TIME_OSR
#define TIME_OSR 4 /* finer time steps: +2.5 pts recall vs 2 (README.md) */
#endif
#ifndef DECODE_PASSES
#define DECODE_PASSES 2 /* second pass over the masked waterfall: +2 pts recall */
#endif
#ifndef MASK_BINS
#define MASK_BINS 0
#endif
#define MAX_DECODED 100
#define FT8_START_OFFSET_S 0.5f
/*
 * SNR calibration: snr = SNR_SLOPE * 10log10(P_tone / P_noise - 1) + SNR_ICPT_DB.
 * Least-squares fit against WSJT-X's own SNR on ft8_lib's 31 test WAVs
 * (259 frequency-matched decodes; median |error| 2.7 dB). The intercept folds
 * in the 2500 Hz reference-bandwidth correction and ft8_lib's window gain.
 */
#define SNR_SLOPE 0.84f
#define SNR_ICPT_DB (-27.7f)
/* ft8_lib's candidate time is ~0.16 s later than WSJT-X's DT on the same audio. */
#define DT_CAL_S (-0.16f)

/* ── callsign hash table (persists between slots, fixed size) ───────────── */
#define HASH_SIZE 256
static struct
{
    char callsign[12];
    uint32_t hash; /* 8 MSB = age, 22 LSB = hash */
} hashtable[HASH_SIZE];

static void hashtable_add(const char *callsign, uint32_t hash)
{
    uint16_t hash10 = (hash >> 12) & 0x3FFu;
    int idx = (hash10 * 23) % HASH_SIZE;
    for (int probes = 0; probes < HASH_SIZE && hashtable[idx].callsign[0] != '\0'; ++probes)
    {
        if (((hashtable[idx].hash & 0x3FFFFFu) == hash) && 0 == strcmp(hashtable[idx].callsign, callsign))
        {
            hashtable[idx].hash &= 0x3FFFFFu; /* reset age */
            return;
        }
        idx = (idx + 1) % HASH_SIZE;
    }
    if (hashtable[idx].callsign[0] != '\0')
        return; /* table full — drop */
    strncpy(hashtable[idx].callsign, callsign, 11);
    hashtable[idx].callsign[11] = '\0';
    hashtable[idx].hash = hash;
}

static bool hashtable_lookup(ftx_callsign_hash_type_t hash_type, uint32_t hash, char *callsign)
{
    uint8_t shift = (hash_type == FTX_CALLSIGN_HASH_10_BITS) ? 12 : (hash_type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0);
    uint16_t hash10 = (hash >> (12 - shift)) & 0x3FFu;
    int idx = (hash10 * 23) % HASH_SIZE;
    for (int probes = 0; probes < HASH_SIZE && hashtable[idx].callsign[0] != '\0'; ++probes)
    {
        if (((hashtable[idx].hash & 0x3FFFFFu) >> shift) == hash)
        {
            strcpy(callsign, hashtable[idx].callsign);
            return true;
        }
        idx = (idx + 1) % HASH_SIZE;
    }
    callsign[0] = '\0';
    return false;
}

static void hashtable_age(uint8_t max_age)
{
    for (int i = 0; i < HASH_SIZE; ++i)
    {
        if (hashtable[i].callsign[0] == '\0')
            continue;
        uint8_t age = (uint8_t)(hashtable[i].hash >> 24);
        if (age > max_age)
        {
            hashtable[i].callsign[0] = '\0';
            hashtable[i].hash = 0;
        }
        else
            hashtable[i].hash = (((uint32_t)age + 1u) << 24) | (hashtable[i].hash & 0x3FFFFFu);
    }
}

static ftx_callsign_hash_interface_t hash_if = { .lookup_hash = hashtable_lookup, .save_hash = hashtable_add };

FT8_API void ft8_reset(void)
{
    memset(hashtable, 0, sizeof(hashtable));
}

FT8_API void ft8_free(void *p)
{
    free(p);
}

/* ── growable string ────────────────────────────────────────────────────── */
typedef struct
{
    char *buf;
    size_t len, cap;
    bool oom;
} sbuf_t;

static void sb_put(sbuf_t *sb, const char *s, size_t n)
{
    if (sb->oom)
        return;
    if (sb->len + n + 1 > sb->cap)
    {
        size_t cap = sb->cap ? sb->cap : 256;
        while (sb->len + n + 1 > cap)
            cap *= 2;
        char *nb = (char *)realloc(sb->buf, cap);
        if (!nb)
        {
            sb->oom = true;
            return;
        }
        sb->buf = nb;
        sb->cap = cap;
    }
    memcpy(sb->buf + sb->len, s, n);
    sb->len += n;
    sb->buf[sb->len] = '\0';
}

static void sb_str(sbuf_t *sb, const char *s)
{
    sb_put(sb, s, strlen(s));
}

static void sb_json_string(sbuf_t *sb, const char *s)
{
    sb_put(sb, "\"", 1);
    for (; *s; ++s)
    {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\')
        {
            char esc[2] = { '\\', (char)c };
            sb_put(sb, esc, 2);
        }
        else if (c < 0x20)
        {
            char esc[8];
            snprintf(esc, sizeof(esc), "\\u%04x", c);
            sb_str(sb, esc);
        }
        else
            sb_put(sb, (const char *)&c, 1);
    }
    sb_put(sb, "\"", 1);
}

/* ── SNR estimate ───────────────────────────────────────────────────────── */

/* Median waterfall element (dB) — the per-bin noise floor of this slot. */
static float waterfall_median_db(const ftx_waterfall_t *wf)
{
    size_t n = (size_t)wf->num_blocks * wf->block_stride;
    if (n == 0)
        return -120.0f;
    /* Histogram, not a sort: elements are uint8_t */
    unsigned long hist[256] = { 0 };
    for (size_t i = 0; i < n; ++i)
        hist[wf->mag[i]]++;
    unsigned long half = (unsigned long)(n / 2), acc = 0;
    for (int v = 0; v < 256; ++v)
    {
        acc += hist[v];
        if (acc > half)
            return WF_ELEM_MAG((uint8_t)v);
    }
    return -120.0f;
}

static float estimate_snr(const ftx_waterfall_t *wf, const ftx_candidate_t *cand, const ftx_message_t *msg, float noise_db)
{
    uint8_t tones[FT8_NN];
    ft8_encode(msg->payload, tones);
    int base = cand->time_offset;
    base = (base * wf->time_osr) + cand->time_sub;
    base = (base * wf->freq_osr) + cand->freq_sub;
    base = (base * wf->num_bins) + cand->freq_offset;
    double sig = 0;
    int n = 0;
    for (int k = 0; k < FT8_NN; ++k)
    {
        int block_abs = cand->time_offset + k;
        if (block_abs < 0 || block_abs >= wf->num_blocks)
            continue;
        int bin = cand->freq_offset + tones[k];
        if (bin < 0 || bin >= wf->num_bins)
            continue;
        const WF_ELEM_T *el = wf->mag + base + k * wf->block_stride + tones[k];
        sig += pow(10.0, WF_ELEM_MAG(*el) / 10.0);
        ++n;
    }
    if (n == 0)
        return -30.0f;
    double ps = sig / n;
    double pn = pow(10.0, noise_db / 10.0);
    double ratio = ps / pn - 1.0;
    if (ratio < 1e-3)
        ratio = 1e-3;
    float snr = SNR_SLOPE * (float)(10.0 * log10(ratio)) + SNR_ICPT_DB;
    if (snr < -30.0f)
        snr = -30.0f;
    if (snr > 40.0f)
        snr = 40.0f;
    return snr;
}

/* dB → stored waterfall element (inverse of WF_ELEM_MAG for uint8 waterfalls) */
static int WF_ELEM_FROM_DB(float db)
{
    float v = db * 2.0f + 240.0f;
    return v < 0 ? 0 : (v > 255 ? 255 : (int)v);
}

/*
 * Spectral masking for multi-pass decoding: set the waterfall cells a decoded
 * signal occupies (its 79 tones in every time/frequency sub-step, ±MASK_BINS)
 * to the noise level, so a weaker signal underneath can sync and decode on
 * the next pass.
 */
static void mask_signal(ftx_waterfall_t *wf, const ftx_candidate_t *cand, const ftx_message_t *msg, uint8_t noise_el)
{
    uint8_t tones[FT8_NN];
    ft8_encode(msg->payload, tones);
    for (int k = 0; k < FT8_NN; ++k)
    {
        int block = cand->time_offset + k;
        if (block < 0 || block >= wf->num_blocks)
            continue;
        int bin = cand->freq_offset + tones[k];
        for (int ts = 0; ts < wf->time_osr; ++ts)
            for (int fs = 0; fs < wf->freq_osr; ++fs)
                for (int d = -MASK_BINS; d <= MASK_BINS; ++d)
                {
                    int b = bin + d;
                    if (b < 0 || b >= wf->num_bins)
                        continue;
                    size_t off = (((size_t)block * wf->time_osr + ts) * wf->freq_osr + fs) * wf->num_bins + b;
                    wf->mag[off] = noise_el;
                }
    }
}

/* ── decode ─────────────────────────────────────────────────────────────── */
FT8_API char *ft8_decode(const float *pcm, int num_samples, int sample_rate, float f_min, float f_max)
{
    sbuf_t out = { 0 };
    sb_str(&out, "[");
    if (!pcm || num_samples <= 0 || sample_rate < 6000)
    {
        sb_str(&out, "]");
        return out.oom ? NULL : out.buf;
    }
    if (!(f_min > 0))
        f_min = 200;
    if (!(f_max > f_min))
        f_max = 3000;

    monitor_t mon;
    monitor_config_t cfg = {
        .f_min = f_min,
        .f_max = f_max,
        .sample_rate = sample_rate,
        .time_osr = TIME_OSR,
        .freq_osr = FREQ_OSR,
        .protocol = FTX_PROTOCOL_FT8,
    };
    monitor_init(&mon, &cfg);
    for (int pos = 0; pos + mon.block_size <= num_samples; pos += mon.block_size)
        monitor_process(&mon, pcm + pos);

    ftx_waterfall_t *wf = &mon.wf;
    float noise_db = waterfall_median_db(wf);
    uint8_t noise_el = (uint8_t)WF_ELEM_FROM_DB(noise_db);

    /* static: keeps the (sizeable) arrays off the small WASM stack */
    static ftx_candidate_t candidates[MAX_CANDIDATES];
    static ftx_message_t decoded[MAX_DECODED];
    static ftx_candidate_t found_cand[MAX_DECODED];
    static ftx_message_t found_msg[MAX_DECODED];
    ftx_message_t *slots[MAX_DECODED] = { 0 };
    int num_found = 0, num_masked = 0;
    int num_decoded = 0;

    for (int pass = 0; pass < DECODE_PASSES; ++pass)
    {
        if (pass > 0)
        {
            /* Mask what earlier passes decoded, so weaker signals under them can sync */
            if (num_masked == num_found)
                break; /* nothing new removed — another pass would find the same */
            for (; num_masked < num_found; ++num_masked)
                mask_signal(wf, &found_cand[num_masked], &found_msg[num_masked], noise_el);
        }
        int num_candidates = ftx_find_candidates(wf, MAX_CANDIDATES, candidates, MIN_SCORE);

    for (int idx = 0; idx < num_candidates && num_decoded < MAX_DECODED; ++idx)
    {
        const ftx_candidate_t *cand = &candidates[idx];
        ftx_message_t message;
        ftx_decode_status_t status;
        if (!ftx_decode_candidate(wf, cand, LDPC_ITERATIONS, &message, &status))
            continue;

        /* duplicate check (same payload found from a neighbouring candidate) */
        int h = message.hash % MAX_DECODED;
        bool dup = false;
        while (slots[h] != NULL)
        {
            if (slots[h]->hash == message.hash && 0 == memcmp(slots[h]->payload, message.payload, sizeof(message.payload)))
            {
                dup = true;
                break;
            }
            h = (h + 1) % MAX_DECODED;
        }
        if (dup)
            continue;
        decoded[h] = message;
        slots[h] = &decoded[h];
        found_cand[num_found] = *cand;
        found_msg[num_found] = message;
        ++num_found;

        char text[FTX_MAX_MESSAGE_LENGTH];
        ftx_message_offsets_t offsets;
        if (ftx_message_decode(&message, &hash_if, text, &offsets) != FTX_MESSAGE_RC_OK)
            continue;

        float freq_hz = (mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / mon.symbol_period;
        float time_s = (cand->time_offset + (float)cand->time_sub / wf->time_osr) * mon.symbol_period;
        float snr = estimate_snr(wf, cand, &message, noise_db);

        char num[96];
        snprintf(num, sizeof(num), "%s{\"snr\":%d,\"dt\":%.1f,\"freq\":%d,\"text\":", num_decoded ? "," : "",
            (int)lroundf(snr), time_s - FT8_START_OFFSET_S + DT_CAL_S, (int)lroundf(freq_hz));
        sb_str(&out, num);
        sb_json_string(&out, text);
        sb_str(&out, "}");
        ++num_decoded;
    }
    } /* passes */
    sb_str(&out, "]");

    monitor_free(&mon);
    hashtable_age(10);

    if (out.oom)
    {
        free(out.buf);
        return NULL;
    }
    return out.buf;
}
