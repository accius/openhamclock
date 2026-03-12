import { createContext, useContext, useState, useCallback } from 'react';

const AppMenuContext = createContext();

export const useAppMenu = () => useContext(AppMenuContext);

export const AppMenuProvider = ({ children }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return <AppMenuContext.Provider value={{ menuOpen, openMenu, closeMenu }}>{children}</AppMenuContext.Provider>;
};
