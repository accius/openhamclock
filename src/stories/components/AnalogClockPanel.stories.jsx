import { AnalogClockPanel } from '@components/AnalogClockPanel.jsx';
import { mockSunTimes } from '@/stories/fixtures.js';

export default {
  title: 'Components/AnalogClockPanel',
  component: AnalogClockPanel
};

export const Default = () => (
  <div style={{ width: 280, height: 220 }}>
    <AnalogClockPanel currentTime={new Date()} sunTimes={mockSunTimes} />
  </div>
);
