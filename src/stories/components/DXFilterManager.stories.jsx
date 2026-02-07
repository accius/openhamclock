import { DXFilterManager } from '@components/DXFilterManager.jsx';

export default {
  title: 'Components/DXFilterManager',
  component: DXFilterManager
};

export const Default = () => (
  <DXFilterManager
    filters={{ bands: ['20m'], modes: ['FT8'], spotRetentionMinutes: 30 }}
    onFilterChange={() => {}}
    isOpen={true}
    onClose={() => {}}
  />
);
