import { LocationPanel } from '@components/LocationPanel.jsx';
import { mockConfig, mockSunTimes } from '@/stories/fixtures.js';

export default {
  title: 'Components/LocationPanel',
  component: LocationPanel
};

export const Default = () => (
  <LocationPanel
    config={mockConfig}
    dxLocation={{ lat: 35.6762, lon: 139.6503 }}
    deSunTimes={mockSunTimes}
    dxSunTimes={mockSunTimes}
    currentTime={new Date()}
    dxLocked={false}
    onToggleDxLock={() => {}}
  />
);
