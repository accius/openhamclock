import { Header } from '@components/Header.jsx';
import { mockConfig, mockSolarIndices, mockSpaceWeather } from '@/stories/fixtures.js';

export default {
  title: 'Components/Header',
  component: Header
};

export const Default = () => (
  <Header
    config={mockConfig}
    utcTime="12:34:56"
    utcDate="2026-02-07"
    localTime="07:34:56"
    localDate="Sat, Feb 7"
    localWeather={{
      data: {
        temp: 72,
        tempUnit: 'F',
        rawTempC: 22,
        rawFeelsLikeC: 21,
        description: 'Partly cloudy',
        icon: '?',
        windSpeed: 12,
        windUnit: 'mph'
      }
    }}
    spaceWeather={mockSpaceWeather}
    solarIndices={mockSolarIndices}
    use12Hour={true}
    onTimeFormatToggle={() => {}}
    onSettingsClick={() => {}}
    onUpdateClick={() => {}}
    onFullscreenToggle={() => {}}
    isFullscreen={false}
    updateInProgress={false}
    showUpdateButton={true}
  />
);
