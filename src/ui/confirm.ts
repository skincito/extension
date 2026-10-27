/**
 * Confirmación propia de la extensión en lugar de `window.confirm`: el diálogo nativo se ve como del
 * navegador y en algunos navegadores cierra el popup. Usa un <dialog> con los estilos de la página
 * (clases `.confirm-*`, ver popup.html). Resuelve `true` al confirmar y `false` al volver o con Esc.
 */
export function askConfirm(options: {title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean}): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm';
  const title = document.createElement('h3'); title.className = 'confirm-title'; title.textContent = options.title;
  const message = document.createElement('p'); message.className = 'confirm-message'; message.textContent = options.message;
  const cancel = document.createElement('button'); cancel.className = 'confirm-cancel'; cancel.textContent = options.cancelLabel ?? 'Volver';
  const ok = document.createElement('button'); ok.className = options.danger ? 'secondary' : 'primary'; ok.textContent = options.confirmLabel ?? 'Confirmar';
  const actions = document.createElement('div'); actions.className = 'actions'; actions.append(cancel, ok);
  dialog.append(title, message, actions);
  document.body.append(dialog);
  return new Promise(resolve => {
    const close = (result: boolean) => {dialog.close(); dialog.remove(); resolve(result)};
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    dialog.addEventListener('cancel', event => {event.preventDefault(); close(false)});
    dialog.showModal();
    cancel.focus();
  });
}
