/**
 * Shared incident: our ICS draft was refused because someone saved a newer
 * one since ours was made (e.g. after a long time offline). Theirs is shown;
 * this banner keeps ours one click away: Apply mine, Show differences, or
 * Keep theirs.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDocConflict, applyMineDoc, dismissDocConflict, diffDocs, subscribeDocs } from '../utils/incidentDocs.js';

const BTN = {
  background: 'transparent',
  border: '1px solid #f59e0b66',
  borderRadius: '3px',
  color: '#f59e0b',
  fontSize: '10px',
  padding: '1px 6px',
  cursor: 'pointer',
};
const show = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function IcsDraftConflict({ docId = 'ics-drafts' }) {
  const { t } = useTranslation();
  const [conflict, setConflict] = useState(() => getDocConflict(docId));
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeDocs((id) => id === docId && setConflict(getDocConflict(docId))), [docId]);
  if (!conflict) return null;
  const diffs = open ? diffDocs(conflict.mine, conflict.theirs) : [];
  return (
    <div
      data-testid="ics-draft-conflict"
      style={{
        border: '1px dashed #f59e0b88',
        background: '#f59e0b14',
        borderRadius: '4px',
        padding: '4px 6px',
        fontSize: '10px',
        color: '#f59e0b',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: '200px' }}>
          {t('icsForms.conflict.text', {
            defaultValue:
              '{{by}} saved these forms after your copy was made, so your changes were not saved over theirs. You are looking at theirs.',
            by: conflict.by || t('icsForms.conflict.someone', { defaultValue: 'Another station' }),
          })}
        </span>
        <button type="button" style={BTN} onClick={() => applyMineDoc(docId)}>
          {t('icsForms.conflict.applyMine', { defaultValue: 'Apply mine' })}
        </button>
        <button type="button" style={BTN} onClick={() => setOpen((v) => !v)}>
          {open
            ? t('icsForms.conflict.hideDiff', { defaultValue: 'Hide differences' })
            : t('icsForms.conflict.showDiff', { defaultValue: 'Show differences' })}
        </button>
        <button type="button" style={BTN} onClick={() => dismissDocConflict(docId)}>
          {t('icsForms.conflict.keepTheirs', { defaultValue: 'Keep theirs' })}
        </button>
      </div>
      {open && (
        <table
          style={{ width: '100%', marginTop: '4px', borderCollapse: 'collapse', color: 'var(--text-primary, #ddd)' }}
        >
          <thead>
            <tr style={{ color: '#f59e0b' }}>
              <th style={{ textAlign: 'left' }}>{t('icsForms.conflict.field', { defaultValue: 'Field' })}</th>
              <th style={{ textAlign: 'left' }}>{t('icsForms.conflict.mine', { defaultValue: 'Yours' })}</th>
              <th style={{ textAlign: 'left' }}>{t('icsForms.conflict.theirs', { defaultValue: 'Theirs' })}</th>
            </tr>
          </thead>
          <tbody>
            {diffs.length === 0 ? (
              <tr>
                <td colSpan={3}>{t('icsForms.conflict.same', { defaultValue: 'No differences' })}</td>
              </tr>
            ) : (
              diffs.map((d) => (
                <tr key={d.path}>
                  <td style={{ fontFamily: 'var(--font-mono)', verticalAlign: 'top' }}>{d.path}</td>
                  <td style={{ verticalAlign: 'top', wordBreak: 'break-word' }}>{show(d.mine)}</td>
                  <td style={{ verticalAlign: 'top', wordBreak: 'break-word' }}>{show(d.theirs)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
