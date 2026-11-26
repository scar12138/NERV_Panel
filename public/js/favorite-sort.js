/* NERV favorite sorting. No dependencies; presentation is provided by the host CSS.
 * init({ grid, doneButton?, saveOrder?, onOrder?, onModeChange?, onError? })
 * saveOrder(ids): Promise<{ok:true,favorites?:Array}> (inject authenticated apiPost).
 * onOrder(ids, result): successful server order, or restored order with rollback:true.
 * Host may re-render inside onOrder; call refresh() after other grid re-renders.
 * Cards: direct .app[data-id] children. The add tile MUST NOT have data-id.
 * Hooks: grid.favorite-sort-mode / .favorite-sort-saving;
 *        card.favorite-sort-shake / .favorite-sort-ghost; floating.favorite-sort-floating.
 */
(function (window) {
  'use strict';
  function init(options) {
    options = options || {};
    var grid = options.grid;
    if (!grid) throw new Error('NervFavoriteSort.init requires grid');
    var doc = grid.ownerDocument;
    var mode = false, destroyed = false, pending = null, drag = null;
    var blockClickUntil = 0, saving = false, chain = Promise.resolve();
    var disabled = new Map(), previousTouch = null;
    var doneButton = options.doneButton;

    function cards() {
      return Array.prototype.filter.call(grid.children, function (el) {
        return el.matches('.app[data-id]');
      });
    }
    function order() { return cards().map(function (el) { return el.getAttribute('data-id'); }); }
    function same(a, b) { return a.length === b.length && a.every(function (id, i) { return id === b[i]; }); }
    function notify(name) {
      if (typeof options[name] !== 'function') return;
      try { options[name].apply(null, Array.prototype.slice.call(arguments, 1)); }
      catch (error) { window.console.error('NervFavoriteSort callback:', error); }
    }
    function arrange(ids) {
      var nodes = cards(), byId = new Map();
      nodes.forEach(function (el) { byId.set(el.getAttribute('data-id'), el); });
      // Keep all non-sortable children (including the add tile) after favorites.
      var anchor = Array.prototype.find.call(grid.children, function (el) { return !nodes.includes(el); }) || null;
      ids.forEach(function (id) { if (byId.has(id)) grid.insertBefore(byId.get(id), anchor); });
    }
    function refresh() {
      if (destroyed) return;
      arrange(order());
      cards().forEach(function (el) {
        el.classList.toggle('favorite-sort-shake', mode);
      });
      if (mode) {
        grid.querySelectorAll('button').forEach(function (button) {
          if (button === doneButton) return;
          if (!disabled.has(button)) disabled.set(button, button.disabled);
          button.disabled = true;
        });
      }
    }
    function setMode(value) {
      if (mode === value) return;
      mode = value;
      grid.classList.toggle('favorite-sort-mode', mode);
      if (mode) {
        previousTouch = { value: grid.style.getPropertyValue('touch-action'), priority: grid.style.getPropertyPriority('touch-action') };
        grid.style.setProperty('touch-action', 'none');
      } else {
        grid.style.setProperty('touch-action', previousTouch.value, previousTouch.priority);
        disabled.forEach(function (value, button) { button.disabled = value; });
        disabled.clear();
      }
      refresh();
      notify('onModeChange', mode);
    }
    function clearPending() {
      if (pending) window.clearTimeout(pending.timer);
      pending = null;
    }
    function release(pointerId) {
      try { if (grid.hasPointerCapture(pointerId)) grid.releasePointerCapture(pointerId); } catch (_) { /* detached grid */ }
    }
    function startDrag(card, event) {
      if (!card.isConnected || saving) return;
      var rect = card.getBoundingClientRect();
      var floating = card.cloneNode(true);
      floating.removeAttribute('id');
      floating.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
      floating.classList.remove('favorite-sort-shake');
      floating.classList.add('favorite-sort-floating');
      floating.setAttribute('aria-hidden', 'true');
      floating.style.cssText += ';position:fixed;pointer-events:none;z-index:10000;margin:0;box-sizing:border-box;width:' + rect.width + 'px;height:' + rect.height + 'px;left:' + rect.left + 'px;top:' + rect.top + 'px;';
      doc.body.appendChild(floating);
      drag = { card: card, floating: floating, pointerId: event.pointerId, before: order(),
        visibility: card.style.visibility,
        offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      card.classList.add('favorite-sort-ghost');
      card.style.visibility = 'hidden';
      blockClickUntil = Date.now() + 800;
      try { grid.setPointerCapture(event.pointerId); } catch (_) { /* document listeners remain active */ }
    }
    function restoreDrag() {
      if (!drag) return;
      var old = drag;
      drag = null;
      old.card.classList.remove('favorite-sort-ghost');
      old.card.style.visibility = old.visibility;
      old.floating.remove();
      release(old.pointerId);
      return old;
    }
    function defaultSave(ids) {
      return window.fetch('/api/apps/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids })
      }).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result || result.ok !== true) throw new Error(result && result.message || '保存排序失败');
          return result;
        });
      });
    }
    function save(ids, before) {
      saving = true;
      grid.classList.add('favorite-sort-saving');
      // All requests pass through one chain; a rejected save cannot poison it.
      chain = chain.catch(function () {}).then(function () {
        return (options.saveOrder || defaultSave)(ids.slice());
      }).then(function (result) {
        if (!result || result.ok !== true) throw new Error(result && result.message || '保存排序失败');
        if (!destroyed) notify('onOrder', ids.slice(), result);
      }).catch(function (error) {
        if (!destroyed) {
          arrange(before);
          notify('onOrder', before.slice(), { ok: false, rollback: true, error: error });
          notify('onError', error);
        }
      }).then(function () {
        saving = false;
        if (!destroyed) { grid.classList.remove('favorite-sort-saving'); refresh(); }
      });
      return chain;
    }
    function pointerDown(event) {
      if (destroyed || pending || drag || saving || !event.isPrimary || event.button !== 0) return;
      var card = event.target.closest && event.target.closest('.app[data-id]');
      if (!card || card.parentNode !== grid) return;
      if (mode) { event.preventDefault(); startDrag(card, event); return; }
      // Do not preventDefault or capture before the hold: tapping and native scroll stay intact.
      pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
      pending.timer = window.setTimeout(function () {
        var hold = pending;
        if (!hold || !card.isConnected) { clearPending(); return; }
        clearPending();
        setMode(true);
        startDrag(card, { pointerId: hold.pointerId, clientX: hold.x, clientY: hold.y });
      }, 500);
    }
    function pointerMove(event) {
      if (pending && event.pointerId === pending.pointerId &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) clearPending();
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.card.isConnected) { cancel(); return; }
      if (event.cancelable) event.preventDefault();
      drag.floating.style.left = (event.clientX - drag.offsetX) + 'px';
      drag.floating.style.top = (event.clientY - drag.offsetY) + 'px';
      var hit = doc.elementFromPoint(event.clientX, event.clientY);
      var target = hit && hit.closest('.app[data-id]');
      if (!target || target === drag.card || target.parentNode !== grid) return;
      var rect = target.getBoundingClientRect();
      var draggingRect = drag.card.getBoundingClientRect();
      var sameRow = Math.abs(draggingRect.top - rect.top) < rect.height / 2;
      var after = sameRow ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      var beforePositions = cards().map(function (card) { return { card: card, rect: card.getBoundingClientRect() }; });
      grid.insertBefore(drag.card, after ? target.nextSibling : target);
      beforePositions.forEach(function (item) {
        if (item.card === drag.card || !item.card.animate) return;
        var next = item.card.getBoundingClientRect();
        if (next.left !== item.rect.left || next.top !== item.rect.top) {
          item.card.animate([{ transform: 'translate(' + (item.rect.left - next.left) + 'px,' + (item.rect.top - next.top) + 'px)' }, { transform: 'translate(0,0)' }], { duration: 140, easing: 'ease-out' });
        }
      });
    }
    function pointerUp(event) {
      if (pending && event.pointerId === pending.pointerId) clearPending();
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (event.cancelable) event.preventDefault();
      blockClickUntil = Date.now() + 800;
      var old = restoreDrag(), ids = order();
      if (!same(ids, old.before)) save(ids, old.before);
    }
    function cancel(event) {
      if (event && pending && event.pointerId !== pending.pointerId && !drag) return;
      clearPending();
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      var old = restoreDrag();
      arrange(old.before);
      blockClickUntil = Date.now() + 800;
    }
    function click(event) {
      if (doneButton && doneButton.contains(event.target)) return;
      if (mode || Date.now() < blockClickUntil) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    function outside(event) {
      if (!mode || grid.contains(event.target) || (doneButton && doneButton.contains(event.target))) return;
      exit();
    }
    function blank(event) {
      if (!mode || event.target.closest('.app[data-id]')) return;
      if (event.target.closest('button,a,input,select,textarea')) return;
      exit();
    }
    function exit() { clearPending(); cancel(); setMode(false); }
    // touch-action is resolved at gesture start. Entering sort mode after the
    // 500ms hold cannot change that gesture, so cancel its native touchmove too.
    // Before a hold is accepted, leave touch scrolling entirely untouched.
    function touchMove(event) {
      if (drag && event.cancelable) event.preventDefault();
    }
    function scroll() { if (!mode) clearPending(); }
    function blur() { cancel(); }
    function context(event) {
      if (mode || pending || Date.now() < blockClickUntil) { event.preventDefault(); }
    }
    function nativeDrag(event) { if (event.target.closest('.app[data-id]')) event.preventDefault(); }
    grid.addEventListener('pointerdown', pointerDown, true);
    doc.addEventListener('pointermove', pointerMove, { passive: false, capture: true });
    doc.addEventListener('touchmove', touchMove, { passive: false, capture: true });
    doc.addEventListener('pointerup', pointerUp, true);
    doc.addEventListener('pointercancel', cancel, true);
    grid.addEventListener('lostpointercapture', cancel);
    grid.addEventListener('click', click, true);
    grid.addEventListener('contextmenu', context);
    grid.addEventListener('dragstart', nativeDrag);
    grid.addEventListener('pointerdown', blank);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', blur);
    if (doneButton) doneButton.addEventListener('click', exit);
    refresh();
    return {
      refresh: refresh, exit: exit,
      isSorting: function () { return mode; },
      isSaving: function () { return saving; },
      whenSaved: function () { return chain; },
      destroy: function () {
        exit(); destroyed = true;
        grid.classList.remove('favorite-sort-saving');
        grid.removeEventListener('pointerdown', pointerDown, true);
        doc.removeEventListener('pointermove', pointerMove, true);
        doc.removeEventListener('touchmove', touchMove, true);
        doc.removeEventListener('pointerup', pointerUp, true);
        doc.removeEventListener('pointercancel', cancel, true);
        grid.removeEventListener('lostpointercapture', cancel);
        grid.removeEventListener('click', click, true);
        grid.removeEventListener('contextmenu', context);
        grid.removeEventListener('dragstart', nativeDrag);
        grid.removeEventListener('pointerdown', blank);
        doc.removeEventListener('pointerdown', outside, true);
        doc.removeEventListener('scroll', scroll, true);
        window.removeEventListener('blur', blur);
        if (doneButton) doneButton.removeEventListener('click', exit);
      }
    };
  }
  window.NervFavoriteSort = { init: init };
})(window);
