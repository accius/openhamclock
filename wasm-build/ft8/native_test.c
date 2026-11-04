/*
 * native_test.c — run ft8_wrapper.c natively (cc, no Emscripten) over WAV
 * files and print one JSON line per file. Used by wasm-build/ft8/test-native.sh
 * to check the wrapper against ft8_lib's reference WSJT-X decodes before the
 * WASM build exists. Repeats every file `REPEAT` times so leak checkers can see
 * that per-call memory is released.
 */
#include <stdio.h>
#include <stdlib.h>

#include <common/wave.h>

char *ft8_decode(const float *pcm, int num_samples, int sample_rate, float f_min, float f_max);
void ft8_free(void *p);
void ft8_reset(void);

int main(int argc, char **argv)
{
    int repeat = getenv("REPEAT") ? atoi(getenv("REPEAT")) : 1;
    for (int i = 1; i < argc; ++i)
    {
        int sample_rate = 12000;
        int num_samples = 15 * 48000; /* room for up to 48 kHz input */
        float *signal = (float *)calloc((size_t)num_samples, sizeof(float));
        if (!signal || load_wav(signal, &num_samples, &sample_rate, argv[i]) < 0)
        {
            fprintf(stderr, "cannot load %s\n", argv[i]);
            free(signal);
            return 1;
        }
        for (int r = 0; r < repeat; ++r)
        {
            ft8_reset();
            char *json = ft8_decode(signal, num_samples, sample_rate, 200, 3000);
            if (r == repeat - 1)
                printf("{\"file\":\"%s\",\"rate\":%d,\"decodes\":%s}\n", argv[i], sample_rate, json ? json : "null");
            ft8_free(json);
        }
        free(signal);
    }
    return 0;
}
