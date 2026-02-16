/**
 * DockableLayoutContext
 * Provides access to the flexlayout model for child components to request panel resizing
 */
import React, { createContext, useContext, useCallback } from 'react';
import { Actions } from 'flexlayout-react';

const DockableLayoutContext = createContext(null);

export const DockableLayoutProvider = ({ model, children }) => {
  /**
   * Request a resize for a panel's parent row/column
   * @param {string} nodeId - The tab node ID
   * @param {number} contentHeight - Desired content height in pixels
   */
  const requestResize = useCallback((nodeId, contentHeight) => {
    if (!model || !nodeId) return;

    try {
      const node = model.getNodeById(nodeId);
      if (!node) return;

      // Find the parent tabset
      const tabset = node.getParent();
      if (!tabset) return;

      // Calculate target height with padding for tab header
      const targetHeight = contentHeight + 60;

      // Set minimum height directly - this forces the panel to be at least this tall
      model.doAction(Actions.updateNodeAttributes(tabset.getId(), {
        minHeight: targetHeight
      }));
    } catch (err) {
      console.warn('Panel resize failed:', err);
    }
  }, [model]);

  /**
   * Reset a panel to its default size
   * @param {string} nodeId - The tab node ID
   */
  const resetSize = useCallback((nodeId) => {
    if (!model || !nodeId) return;

    try {
      const node = model.getNodeById(nodeId);
      if (!node) return;

      const tabset = node.getParent();
      if (!tabset) return;

      // Remove the minHeight constraint
      model.doAction(Actions.updateNodeAttributes(tabset.getId(), {
        minHeight: 0
      }));
    } catch (err) {
      console.warn('Panel reset failed:', err);
    }
  }, [model]);

  return (
    <DockableLayoutContext.Provider value={{ model, requestResize, resetSize }}>
      {children}
    </DockableLayoutContext.Provider>
  );
};

/**
 * Hook to access panel resize functionality
 * @param {string} nodeId - The current tab's node ID (passed from factory)
 */
export const usePanelResize = (nodeId) => {
  const context = useContext(DockableLayoutContext);

  const requestResize = useCallback((contentHeight) => {
    context?.requestResize(nodeId, contentHeight);
  }, [context, nodeId]);

  const resetSize = useCallback(() => {
    context?.resetSize(nodeId);
  }, [context, nodeId]);

  return { requestResize, resetSize };
};

export default DockableLayoutContext;
