import { PSKFilterManager } from '@components/PSKFilterManager.jsx';

export default {
  title: 'Components/PSKFilterManager',
  component: PSKFilterManager
};

export const Default = () => (
  <PSKFilterManager
    filters={{ bands: ['20m'], grids: ['FN'], modes: ['FT8'] }}
    onFilterChange={() => {}}
    isOpen={true}
    onClose={() => {}}
  />
);
