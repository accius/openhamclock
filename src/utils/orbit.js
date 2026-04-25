/*
https://github.com/Flowm/satvis/blob/next/src/modules/Orbit.js

MIT License

Copyright (c) 2018 Florian Mauracher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import * as satellitejs from 'satellite.js';

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;

export default class Orbit {
  constructor(name, tle) {
    this.name = name;
    this.tle = tle.split('\n');
    this.satrec = satellitejs.twoline2satrec(this.tle[1], this.tle[2]);
  }

  get satnum() {
    return this.satrec.satnum;
  }

  get error() {
    return this.satrec.error;
  }

  get julianDate() {
    return this.satrec.jdsatepoch;
  }

  get orbitalPeriod() {
    const meanMotionRad = this.satrec.no;
    const period = (2 * Math.PI) / meanMotionRad;
    return period;
  }

  positionECI(time) {
    const result = satellitejs.propagate(this.satrec, time);
    return result ? result.position : null;
  }

  positionECF(time) {
    const positionEci = this.positionECI(time);
    if (!positionEci) return null;
    const gmst = satellitejs.gstime(time);
    const positionEcf = satellitejs.eciToEcf(positionEci, gmst);
    return positionEcf;
  }

  positionGeodetic(timestamp, calculateVelocity = false) {
    const result = satellitejs.propagate(this.satrec, timestamp);
    if (!result) return null;
    const { position: positionEci, velocity: velocityVector } = result;
    const gmst = satellitejs.gstime(timestamp);
    const positionGd = satellitejs.eciToGeodetic(positionEci, gmst);

    return {
      longitude: positionGd.longitude * rad2deg,
      latitude: positionGd.latitude * rad2deg,
      height: positionGd.height * 1000,
      ...(calculateVelocity && {
        velocity: Math.sqrt(
          velocityVector.x * velocityVector.x +
            velocityVector.y * velocityVector.y +
            velocityVector.z * velocityVector.z,
        ),
      }),
    };
  }

  computePassesElevation(
    groundStationPosition,
    startDate = new Date(),
    endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days later
    minElevation = 5,
    maxPasses = 50,
  ) {
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000;

    const date = new Date(startDate);
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastElevation = null;
    // eslint-disable-next-line no-unmodified-loop-condition -- date is mutated via setMinutes/setSeconds
    while (date < endDate) {
      const positionEcf = this.positionECF(date);
      if (!positionEcf) {
        date.setMinutes(date.getMinutes() + 1);
        continue;
      }
      const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
      const elevation = lookAngles.elevation / deg2rad;

      if (elevation > minElevation) {
        // satellite is above minimum elevation, part of a pass

        if (!ongoingPass) {
          // Start of new pass
          pass = {
            name: this.name,
            start: date.getTime(),
            azimuthStart: lookAngles.azimuth,
            maxElevation: elevation,
            apex: date.getTime(),
            azimuthApex: lookAngles.azimuth,
          };
          ongoingPass = true;
        } else if (elevation > pass.maxElevation) {
          // Ongoing pass, update max elevation and apex time
          pass.maxElevation = elevation;
          pass.apex = date.getTime();
          pass.azimuthApex = lookAngles.azimuth;
        }

        // advance 5s in next iteration
        date.setSeconds(date.getSeconds() + 5);
      } else if (ongoingPass) {
        // End of pass
        pass.end = date.getTime();
        pass.duration = pass.end - pass.start;
        pass.azimuthEnd = lookAngles.azimuth;
        pass.azimuthStart /= deg2rad;
        pass.azimuthApex /= deg2rad;
        pass.azimuthEnd /= deg2rad;
        passes.push(pass);
        if (passes.length > maxPasses) {
          break;
        }
        ongoingPass = false;
        lastElevation = null;
        date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5); // skip ahead to next potential pass
      } else {
        // satellite is below minimum elevation and not currently in a pass
        const deltaElevation = elevation - (lastElevation || elevation); // if lastElevation is null then delta will be zero, which will not trigger the descending logic
        lastElevation = elevation;
        if (deltaElevation < 0) {
          // deltaElevation is negative, satellite is descending, skip ahead to speed up calculation
          lastElevation = null;
          date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5); // skip ahead to next potential pass
        } else if (elevation < -60) {
          date.setMinutes(date.getMinutes() + 15);
        } else if (elevation < -30) {
          date.setMinutes(date.getMinutes() + 5);
        } else if (elevation < -10) {
          date.setMinutes(date.getMinutes() + 1);
        } else if (elevation < minElevation - 3) {
          date.setSeconds(date.getSeconds() + 30);
        } else {
          date.setSeconds(date.getSeconds() + 5);
        }
      }
    }
    return passes;
  }
}
