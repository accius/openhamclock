import { SettingsPanel } from '@components/SettingsPanel.jsx';
import { mockConfig, mockSatellites } from '@/stories/fixtures.js';

export default {
  title: 'Components/SettingsPanel',
  component: SettingsPanel
};

export const Default = () => (
  <SettingsPanel
    isOpen={true}
    onClose={() => {}}
    config={mockConfig}
    onSave={() => {}}
    onResetLayout={() => {}}
    satellites={mockSatellites}
    satelliteFilters={[]}
    onSatelliteFiltersChange={() => {}}
  />
);
