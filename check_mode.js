
const bandPlan = [
    {
        "min": 1800,
        "max": 1840,
        "mode": "LSB",
        "desc": "160m CW"
    },
    {
        "min": 1840,
        "max": 2000,
        "mode": "LSB",
        "desc": "160m SSB"
    },
    {
        "min": 3500,
        "max": 3600,
        "mode": "LSB",
        "desc": "80m CW"
    },
    {
        "min": 3600,
        "max": 4000,
        "mode": "LSB",
        "desc": "80m SSB"
    },
    {
        "min": 5330,
        "max": 5405,
        "mode": "USB",
        "desc": "60m"
    },
    {
        "min": 7000,
        "max": 7040,
        "mode": "LSB",
        "desc": "40m CW"
    },
    {
        "min": 7040,
        "max": 7300,
        "mode": "LSB",
        "desc": "40m SSB"
    },
    {
        "min": 10100,
        "max": 10130,
        "mode": "USB",
        "desc": "30m CW"
    },
    {
        "min": 10130,
        "max": 10150,
        "mode": "USB",
        "desc": "30m Data"
    },
    {
        "min": 14000,
        "max": 14070,
        "mode": "USB",
        "desc": "20m CW"
    },
    {
        "min": 14070,
        "max": 14100,
        "mode": "USB",
        "desc": "20m Data"
    },
    {
        "min": 14100,
        "max": 14350,
        "mode": "USB",
        "desc": "20m SSB"
    }
];

const getModeFromFreq = (hz) => {
    if (!hz) return 'USB';

    const khz = hz / 1000;
    const mhz = hz / 1000000;

    console.log(`Checking ${hz} Hz (${khz} kHz)`);

    for (const range of bandPlan) {
        if (khz >= range.min && khz <= range.max) {
            console.log(`Matched range: ${range.min}-${range.max} (${range.desc}) -> ${range.mode}`);
            return range.mode;
        }
    }

    if (mhz < 10) return 'LSB';
    return 'USB';
};

const getSideband = (hz) => {
    if (!hz) return 'USB';
    const mhz = hz / 1000000;
    if (mhz >= 5.3 && mhz <= 5.405) return 'USB';
    return mhz < 10 ? 'LSB' : 'USB';
};

const mapModeToRig = (mode, freq) => {
    if (!mode) return '';
    const m = mode.toUpperCase();
    const sb = getSideband(freq);

    const digitalModes = ['FT8', 'FT4', 'JS8', 'WSPR', 'JT65', 'JT9', 'PSK31', 'PSK63', 'RTTY', 'DATA', 'PKT'];

    if (digitalModes.includes(m) || m === 'CW' || m === 'SSB') {
        return sb;
    }
    return m;
};

const freq = 7085000; // 7.085 MHz
const mode = getModeFromFreq(freq);
const rigMode = mapModeToRig(mode, freq);

console.log(`Result for ${freq}: Mode=${mode}, RigMode=${rigMode}`);
