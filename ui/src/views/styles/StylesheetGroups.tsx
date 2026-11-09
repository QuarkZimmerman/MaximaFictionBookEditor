/**
 * Feature 011 (US8; D42; contracts/styles.md §3): the Styles view's list - one group per stylesheet
 * with its type, the default one first in its place and marked, each editable group's rules one per
 * selector, a rule in conflict with another stylesheet marked; a stylesheet of another type or with
 * faults shown as read, its faults listed.
 */
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import type { StyleGroup } from '@/features/styles/stylesheetModel';

export interface StyleSelection {
  group: number;
  /** null: the group itself (its header). */
  rule: number | null;
}

export interface StylesheetGroupsProps {
  groups: readonly StyleGroup[];
  defaultIndex: number | null;
  selection: StyleSelection | null;
  /** The conflict texts of a rule, by `group:rule`. */
  conflicts: ReadonlyMap<string, string[]>;
  onSelect: (selection: StyleSelection) => void;
}

export function StylesheetGroups({
  groups,
  defaultIndex,
  selection,
  conflicts,
  onSelect,
}: StylesheetGroupsProps) {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return (
      <div className="mfbe-styles-groups" data-testid="styles-groups">
        <p className="mfbe-styles-empty" data-testid="styles-empty">
          {t('styles.empty')}
        </p>
      </div>
    );
  }
  return (
    <div
      className="mfbe-styles-groups"
      data-testid="styles-groups"
      role="tree"
      aria-label={t('styles.list')}
    >
      {groups.map((group) => {
        const headerSelected = selection?.group === group.index && selection.rule === null;
        return (
          <div
            key={group.index}
            className="mfbe-styles-group"
            data-testid={`styles-group-${group.index}`}
            data-editable={group.editable ? 'true' : 'false'}
          >
            <div
              role="treeitem"
              aria-level={1}
              aria-selected={headerSelected}
              tabIndex={-1}
              className={`mfbe-styles-group-header${headerSelected ? ' mfbe-styles-selected' : ''}`}
              data-testid={`styles-group-${group.index}-header`}
              onClick={() => onSelect({ group: group.index, rule: null })}
              {...tip(t('styles.groupTip'))}
            >
              {t('styles.group', { number: group.index + 1, type: group.type || 'text/css' })}
              {group.index === defaultIndex ? (
                <span className="mfbe-styles-default">{t('styles.defaultMark')}</span>
              ) : null}
            </div>
            {group.editable ? (
              group.rules.map((rule, index) => {
                const key = `${group.index}:${index}`;
                const selected = selection?.group === group.index && selection.rule === index;
                const conflict = conflicts.get(key);
                return (
                  <div
                    key={key}
                    role="treeitem"
                    aria-level={2}
                    aria-selected={selected}
                    tabIndex={-1}
                    className={`mfbe-styles-rule${selected ? ' mfbe-styles-selected' : ''}`}
                    data-testid={`styles-rule-${group.index}-${index}`}
                    data-conflict={conflict ? 'true' : undefined}
                    onClick={() => onSelect({ group: group.index, rule: index })}
                    {...tip(conflict ? conflict.join('\n') : t('styles.ruleTip'))}
                  >
                    <code>{rule.selector}</code>
                    {conflict ? (
                      <span
                        className="mfbe-table-mark-badge mfbe-styles-mark"
                        role="img"
                        aria-label={conflict.join('\n')}
                      >
                        !
                      </span>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div
                className="mfbe-styles-readonly"
                data-testid={`styles-group-${group.index}-readonly`}
              >
                <p>{group.faults.length > 0 ? t('styles.faulty') : t('styles.otherType')}</p>
                {group.faults.length > 0 ? (
                  <ul>
                    {group.faults.map((fault) => (
                      <li key={fault}>{fault}</li>
                    ))}
                  </ul>
                ) : null}
                <pre>{group.text}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
