// Grinders tab: list + add/edit form.
import { h, icon, clear, numericInput, nf0 } from './util.js';
import { S, saveGrinder, deleteGrinder } from './store.js';
import { openSheet, toast, confirmDialog, field, group, segmented } from './ui.js';
import { emptyState, pageHead, chip } from './parts.js';

export const STEP_OPTIONS = [0.1, 0.5, 1, 2];
const stepLabel = (n) => String(n).replace(/^0\./, '.');

export function grinderSummary(g) {
  return `${g.type === 'manual' ? 'Manual' : 'Automatic'} · ${g.burr === 'flat' ? 'Flat' : 'Conical'} burr`;
}

export function renderGrinders(root) {
  clear(root);
  const add = () => openGrinderForm();
  root.append(pageHead('Grinders', S.grinders.length ? `${S.grinders.length} ${S.grinders.length === 1 ? 'grinder' : 'grinders'}` : 'The tools that set your grind',
    h('button.btn.primary.head-add', { type: 'button', onclick: add }, icon('plus', 18), 'Add grinder')));
  if (!S.grinders.length) {
    root.append(emptyState({
      iconName: 'grinders', title: 'No grinders yet',
      text: 'Add your grinder once. When you brew, its click count sets the top of the grind size scale.',
      action: h('button.btn.primary', { type: 'button', onclick: add }, icon('plus', 18), 'Add a grinder'),
    }));
  } else {
    root.append(h('div.grinder-list', S.grinders.map(g => {
      const uses = S.brews.filter(b => b.grinderId === g.id).length;
      return h('article.grinder', { tabindex: 0, role: 'button', onclick: () => openGrinderForm(g), onkeydown: (e) => { if (e.key === 'Enter') openGrinderForm(g); } },
        h('div.grinder-ico', icon('grinders', 30)),
        h('div.grinder-main',
          h('h3', g.name),
          h('p.muted', grinderSummary(g)),
          h('div.bean-facts', chip(`Step ${stepLabel(g.step)}`), chip(`${nf0.format(g.clicks)} clicks max`), uses ? chip(`${uses} ${uses === 1 ? 'brew' : 'brews'}`) : null)),
        icon('chevronR', 20, 'go'));
    })));
  }
  root.append(h('button.fab', { type: 'button', 'aria-label': 'Add grinder', onclick: add }, icon('plus', 26)));
}

export function openGrinderForm(existing = null) {
  const editing = !!existing;
  const d = existing ? { ...existing } : { name: '', type: 'manual', burr: 'conical', step: 1, clicks: '' };
  const nameIn = h('input', { type: 'text', value: d.name, placeholder: 'e.g. Comandante C40', autocomplete: 'off', maxlength: 60 });
  nameIn.addEventListener('input', () => { nameIn.classList.remove('invalid'); });
  const type = segmented({ options: [{ v: 'manual', label: 'Manual' }, { v: 'automatic', label: 'Automatic' }], value: d.type });
  const burr = segmented({ options: [{ v: 'conical', label: 'Conical burr' }, { v: 'flat', label: 'Flat burr' }], value: d.burr });
  const step = segmented({ options: STEP_OPTIONS.map(n => ({ v: n, label: stepLabel(n) })), value: d.step });
  const clicks = numericInput(h('input', { type: 'text', value: d.clicks || '', placeholder: 'e.g. 40', 'aria-label': 'Clicks' }));
  clicks.addEventListener('input', () => clicks.classList.remove('invalid'));
  const err = h('div.form-err', { role: 'alert' });

  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    field('Name', nameIn),
    group('Type', type.el),
    group('Burr', burr.el),
    group('Step size', step.el, 'How far one adjustment moves the grind.'),
    field('Clicks', clicks, 'The highest setting on this grinder. Brews cap the grind size here.'));

  const sheet = openSheet({
    title: editing ? 'Edit grinder' : 'New grinder', size: 'md', className: 'form-sheet', body: form,
    footer: [
      err,
      editing ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => {
        const uses = S.brews.filter(b => b.grinderId === d.id).length;
        const ok = await confirmDialog({ title: 'Delete this grinder?', text: uses ? `${d.name} is used in ${uses} ${uses === 1 ? 'brew' : 'brews'}. Those brews stay, but will show no grinder.` : `${d.name} will be deleted.`, confirmLabel: 'Delete', danger: true });
        if (ok) { await deleteGrinder(d.id); sheet.close(); toast('Grinder deleted'); }
      } }, icon('trash', 16), 'Delete') : null,
      h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'),
      h('button.btn.primary', { type: 'button', onclick: () => save() }, editing ? 'Save changes' : 'Add grinder'),
    ],
  });
  if (!editing) setTimeout(() => nameIn.focus({ preventScroll: true }), 260);

  async function save() {
    const missing = [];
    if (!nameIn.value.trim()) { missing.push('name'); nameIn.classList.add('invalid'); }
    if (!(Number(clicks.value) > 0)) { missing.push('clicks'); clicks.classList.add('invalid'); }
    if (missing.length) { err.textContent = `Fill in: ${missing.join(', ')}.`; return; }
    await saveGrinder({ ...(existing || {}), name: nameIn.value.trim(), type: type.get(), burr: burr.get(), step: step.get(), clicks: Number(clicks.value) });
    sheet.close(); toast(editing ? 'Changes saved' : 'Grinder added');
  }
}
