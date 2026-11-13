// 2026-11-13: frame-driven pointer input gives both plays the same in-slot drag and drop without changing the saved order.
export const handSlotDrag = `return new Promise(resolve => {
  const element = document.querySelector('.hand-slot [data-card-id="card:2"] .deck-card-open');
  const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const send = (target, type, dx, buttons = 1) => target.dispatchEvent(new PointerEvent(type, {
    bubbles:true, pointerType:'mouse', pointerId:1, isPrimary:true, button:0, buttons, clientX:x+dx, clientY:y
  }));
  send(element, 'pointerdown', 0);
  let step = 0; window.dragSeen = false;
  function move() {
    const dx = step < 2 ? 12 + step * 2 : 14 + Math.min(step - 2, 20) * .8;
    send(document, 'pointermove', dx);
    window.dragSeen ||= Boolean(document.querySelector('.card-drag-face'));
    if (step++ < 35) return requestAnimationFrame(move);
    send(document, 'pointerup', dx, 0); resolve();
  }
  requestAnimationFrame(move);
})`;
