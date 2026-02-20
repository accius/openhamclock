/**
 * DockableLayout Component
 * Provides resizable, dockable panel layout using flexlayout-react
 * while maintaining openhamclock's visual style
 */
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';
import { loadLayout, saveLayout, resetLayout, DEFAULT_LAYOUT, PANEL_DEFINITIONS } from '../store/layoutStore.js';
import '../styles/flexlayout-openhamclock.css';

// Icons for toolbar
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const DockableLayout = ({
  children,
  // Panel render functions passed from App
  renderLeftSidebar,
  renderRightSidebar,
  renderWorldMap,
  renderHeader,
  // Individual panel render functions for advanced docking
  renderPanels = {},
}) => {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(() => Model.fromJson(loadLayout()));
  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [targetTabSetId, setTargetTabSetId] = useState(null);
  const saveTimeoutRef = useRef(null);

  // Handle model changes with debounced save
  const handleModelChange = useCallback((newModel) => {
    setModel(newModel);

    // Debounce saves - wait 500ms after last change
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveLayout(newModel.toJson());
    }, 500);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Reset layout to default
  const handleResetLayout = useCallback(() => {
    if (confirm('Reset panel layout to default? This will undo any customizations.')) {
      const defaultLayout = resetLayout();
      setModel(Model.fromJson(defaultLayout));
    }
  }, []);

  // Add a new panel to a tabset
  const handleAddPanel = useCallback(
    (panelId) => {
      if (!targetTabSetId || !PANEL_DEFINITIONS[panelId]) return;

      const panel = PANEL_DEFINITIONS[panelId];

      model.doAction(
        Actions.addNode(
          {
            type: 'tab',
            name: panel.name,
            component: panelId,
            id: `${panelId}-${Date.now()}`,
          },
          targetTabSetId,
          DockLocation.CENTER,
          -1,
          true,
        ),
      );

      setShowPanelPicker(false);
      setTargetTabSetId(null);
    },
    [model, targetTabSetId],
  );

  // Render tab content based on component type
  const factory = useCallback(
    (node) => {
      const component = node.getComponent();

      switch (component) {
        case 'left-sidebar':
          return renderLeftSidebar ? renderLeftSidebar() : <div>Left Sidebar</div>;

        case 'right-sidebar':
          return renderRightSidebar ? renderRightSidebar() : <div>Right Sidebar</div>;

        case 'world-map':
          return renderWorldMap ? renderWorldMap() : <div>World Map</div>;

        // Individual panels for advanced docking
        case 'de-location':
          return renderPanels.deLocation ? renderPanels.deLocation() : null;

        case 'dx-location':
          return renderPanels.dxLocation ? renderPanels.dxLocation() : null;

        case 'solar':
          return renderPanels.solar ? renderPanels.solar() : null;

        case 'propagation':
          return renderPanels.propagation ? renderPanels.propagation() : null;

        case 'dx-cluster':
          return renderPanels.dxCluster ? renderPanels.dxCluster() : null;

        case 'psk-reporter':
          return renderPanels.pskReporter ? renderPanels.pskReporter() : null;

        case 'dxpeditions':
          return renderPanels.dxpeditions ? renderPanels.dxpeditions() : null;

        case 'pota':
          return renderPanels.pota ? renderPanels.pota() : null;

        case 'contests':
          return renderPanels.contests ? renderPanels.contests() : null;

        default:
          return <div style={{ padding: '20px', color: '#888' }}>Unknown panel: {component}</div>;
      }
    },
    [renderLeftSidebar, renderRightSidebar, renderWorldMap, renderPanels],
  );

  // Custom tab set rendering with + button
  const onRenderTabSet = useCallback((node, renderValues) => {
    // Add + button to tabset header
    renderValues.stickyButtons.push(
      <button
        key="add-panel"
        title="Add panel to this area"
        className="flexlayout__tab_toolbar_button"
        onClick={(e) => {
          e.stopPropagation();
          setTargetTabSetId(node.getId());
          setShowPanelPicker(true);
        }}
        style={{ padding: '4px 6px' }}
      >
        <PlusIcon />
      </button>,
    );
  }, []);

  // Get panels that are not already in the layout
  const getAvailablePanels = useCallback(() => {
    const usedComponents = new Set();

    // Walk the model to find used components
    const walkNode = (node) => {
      if (node.getType() === 'tab') {
        usedComponents.add(node.getComponent());
      }
      const children = node.getChildren?.() || [];
      children.forEach(walkNode);
    };

    walkNode(model.getRoot());

    // Return panels not in use
    return Object.entries(PANEL_DEFINITIONS)
      .filter(([id]) => !usedComponents.has(id))
      .map(([id, def]) => ({ id, ...def }));
  }, [model]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Header - always at top, not part of dockable layout */}
      {renderHeader && <div style={{ flexShrink: 0 }}>{renderHeader()}</div>}

      {/* Dockable panel area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          padding: '8px',
          minHeight: 0, // Important for flexbox
        }}
      >
        <Layout
          ref={layoutRef}
          model={model}
          factory={factory}
          onModelChange={handleModelChange}
          onRenderTabSet={onRenderTabSet}
        />

        {/* Reset layout button */}
        <button
          onClick={handleResetLayout}
          title="Reset layout to default"
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            background: 'rgba(26, 32, 44, 0.9)',
            border: '1px solid #2d3748',
            color: '#a0aec0',
            padding: '8px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
            zIndex: 1000,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#00ffcc';
            e.currentTarget.style.color = '#00ffcc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#2d3748';
            e.currentTarget.style.color = '#a0aec0';
          }}
        >
          <ResetIcon /> Reset Layout
        </button>
      </div>

      {/* Panel picker modal */}
      {showPanelPicker && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowPanelPicker(false)}
        >
          <div
            style={{
              background: 'rgba(26, 32, 44, 0.98)',
              border: '1px solid #2d3748',
              borderRadius: '12px',
              padding: '20px',
              minWidth: '400px',
              maxWidth: '500px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 16px 0',
                color: '#00ffcc',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '16px',
                fontWeight: '600',
              }}
            >
              Add Panel
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}
            >
              {getAvailablePanels().map((panel) => (
                <button
                  key={panel.id}
                  onClick={() => handleAddPanel(panel.id)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid #2d3748',
                    borderRadius: '8px',
                    padding: '12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#00ffcc';
                    e.currentTarget.style.background = 'rgba(0, 255, 204, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#2d3748';
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.3)';
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{panel.icon}</span>
                    <span
                      style={{
                        color: '#e2e8f0',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '13px',
                        fontWeight: '600',
                      }}
                    >
                      {panel.name}
                    </span>
                  </div>
                  <div
                    style={{
                      color: '#718096',
                      fontSize: '11px',
                      lineHeight: 1.4,
                    }}
                  >
                    {panel.description}
                  </div>
                </button>
              ))}
            </div>

            {getAvailablePanels().length === 0 && (
              <div
                style={{
                  color: '#718096',
                  textAlign: 'center',
                  padding: '20px',
                  fontStyle: 'italic',
                }}
              >
                All panels are already visible
              </div>
            )}

            <button
              onClick={() => setShowPanelPicker(false)}
              style={{
                width: '100%',
                marginTop: '16px',
                background: 'transparent',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                padding: '10px',
                color: '#a0aec0',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DockableLayout;
