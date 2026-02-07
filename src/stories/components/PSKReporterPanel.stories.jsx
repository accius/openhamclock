import { PSKReporterPanel } from '@components/PSKReporterPanel.jsx';

export default {
  title: 'Components/PSKReporterPanel',
  component: PSKReporterPanel
};

export const Default = () => (
  <div style={{ height: 300 }}>
    <PSKReporterPanel
      callsign="N0CALL"
      onShowOnMap={() => {}}
      showOnMap={false}
      onToggleMap={() => {}}
      filters={{}}
      onOpenFilters={() => {}}
      wsjtxDecodes={[]}
      wsjtxClients={{}}
      wsjtxQsos={[]}
      wsjtxStats={{}}
      wsjtxLoading={false}
      wsjtxEnabled={false}
      wsjtxPort={2237}
      wsjtxRelayEnabled={false}
      wsjtxRelayConnected={false}
      wsjtxSessionId=""
      showWSJTXOnMap={false}
      onToggleWSJTXMap={() => {}}
    />
  </div>
);
