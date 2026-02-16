# ITURHFProp Service

REST API wrapper for the [ITURHFProp](https://github.com/ITU-R-Study-Group-3/ITU-R-HF) HF propagation prediction engine, implementing **ITU-R P.533-14** "Method for the prediction of the performance of HF circuits".

## Overview

This microservice provides HF propagation predictions as a REST API, suitable for integration with OpenHamClock or any amateur radio application needing professional-grade propagation forecasts.

### Why ITURHFProp?

- **ITU-R P.533-14 Compliant** - The international standard for HF prediction
- **Official ITU Release** - From ITU-R Study Group 3
- **Pre-built Binaries** - No compilation required
- **No API Restrictions** - Unlike web services, you control the engine

## API Endpoints

### Health Check
```
GET /api/health
```

Response:
```json
{
  "status": "healthy",
  "service": "iturhfprop",
  "engine": "ITURHFProp (ITU-R P.533-14)"
}
```

### Single Point Prediction
```
GET /api/predict?txLat=40.1&txLon=-74.8&rxLat=51.5&rxLon=-0.1&month=1&hour=12&ssn=100
```

Parameters:
| Param | Required | Description |
|-------|----------|-------------|
| txLat | Yes | Transmitter latitude |
| txLon | Yes | Transmitter longitude |
| rxLat | Yes | Receiver latitude |
| rxLon | Yes | Receiver longitude |
| month | No | Month (1-12), default: current |
| hour | No | UTC hour (0-23), default: current |
| ssn | No | Smoothed Sunspot Number, default: 100 |
| year | No | Year, default: current |
| txPower | No | TX power in watts, default: 100 |
| frequencies | No | Comma-separated MHz values |

Response:
```json
{
  "model": "ITU-R P.533-14",
  "engine": "ITURHFProp",
  "muf": 28.5,
  "frequencies": [
    { "freq": 14.1, "reliability": 85, "snr": 25, "sdbw": -95 },
    { "freq": 21.1, "reliability": 72, "snr": 18, "sdbw": -102 }
  ],
  "elapsed": 150
}
```

### 24-Hour Prediction
```
GET /api/predict/hourly?txLat=40.1&txLon=-74.8&rxLat=51.5&rxLon=-0.1&month=1&ssn=100
```

Returns predictions for each hour (0-23 UTC).

### Band Conditions (Simplified)
```
GET /api/bands?txLat=40.1&txLon=-74.8&rxLat=51.5&rxLon=-0.1
```

Response:
```json
{
  "model": "ITU-R P.533-14",
  "muf": 28.5,
  "bands": {
    "20m": { "freq": 14.1, "reliability": 85, "status": "GOOD" },
    "15m": { "freq": 21.1, "reliability": 72, "status": "GOOD" },
    "10m": { "freq": 28.1, "reliability": 45, "status": "FAIR" }
  }
}
```

## Deployment

### Railway (Recommended)

1. Create a new project on [Railway](https://railway.app)
2. Connect this directory as a service
3. Deploy!

The Dockerfile will:
- Clone and build ITURHFProp from source
- Set up the Node.js API wrapper
- Configure all necessary data files

### Docker

```bash
# Build
docker build -t iturhfprop-service .

# Run
docker run -p 3000:3000 iturhfprop-service

# Test
curl http://localhost:3000/api/health
```

### Local Development

Download ITURHFProp binaries from the [official release](https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases):

```bash
# Download binaries (Linux)
curl -L -o ITURHFProp "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/ITURHFProp"
curl -L -o libp533.so "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/libp533.so"
curl -L -o libp372.so "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/libp372.so"
chmod +x ITURHFProp

# Download source for Data files
curl -L -o source.tar.gz "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/archive/refs/tags/v14.3.tar.gz"
tar -xzf source.tar.gz
mv ITU-R-HF-14.3/Data .
mv ITU-R-HF-14.3/IonMap .

# Set environment variables
export ITURHFPROP_PATH=$(pwd)/ITURHFProp
export ITURHFPROP_DATA=$(pwd)
export LD_LIBRARY_PATH=$(pwd):$LD_LIBRARY_PATH

# Run service
npm install
npm start
```

## Integration with OpenHamClock

In your OpenHamClock server.js, add:

```javascript
const ITURHFPROP_SERVICE = process.env.ITURHFPROP_URL || 'http://localhost:3001';

app.get('/api/propagation', async (req, res) => {
  const { deLat, deLon, dxLat, dxLon } = req.query;
  
  try {
    const response = await fetch(
      `${ITURHFPROP_SERVICE}/api/bands?txLat=${deLat}&txLon=${deLon}&rxLat=${dxLat}&rxLon=${dxLon}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    // Fallback to built-in estimation
    res.json(calculateFallbackPropagation(deLat, deLon, dxLat, dxLon));
  }
});
```

## Performance

- **Cold start**: ~5 seconds (Docker container initialization)
- **Prediction time**: 100-300ms per calculation
- **24-hour forecast**: 3-7 seconds

## Technical Details

### ITU-R P.533-14

The prediction model accounts for:
- F2-layer propagation (main HF mode)
- E-layer propagation
- Sporadic-E when applicable
- D-layer absorption
- Ground wave (short paths)
- Antenna gains
- Man-made noise levels
- Required SNR and reliability

### Limitations

- Single-hop paths only (< 4000 km optimal)
- Does not predict sporadic-E openings
- Monthly median predictions (not real-time ionospheric conditions)

For real-time enhancement, combine with ionosonde data from KC2G/GIRO network.

## License

This service wrapper is MIT licensed.

ITURHFProp is provided by ITU-R Study Group 3 - see [ITU-R-Study-Group-3/ITU-R-HF](https://github.com/ITU-R-Study-Group-3/ITU-R-HF) for details.

## Credits

- **ITURHFProp** by ITU-R Study Group 3 - The core prediction engine
- **ITU-R P.533-14** - International Telecommunication Union recommendation  
- **Chris Behm & George Engelbrecht** - Original ITURHFProp developers
- **OpenHamClock** - Integration target

---

*73 de OpenHamClock contributors*
