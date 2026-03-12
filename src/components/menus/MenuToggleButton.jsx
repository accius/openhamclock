import { useAppMenu } from '../../contexts/AppMenuContext';

export default function MenuToggleButton() {
  const { openMenu } = useAppMenu();

  return (
    <button onClick={openMenu} title="Menu" className="header-menu-toggle">
      ☰
    </button>
  );
}
