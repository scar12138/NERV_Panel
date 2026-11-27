/* Inline, token-protected process association. Lists only server snapshots; never controls processes. */
(function (window) {
  'use strict';
  window.NervProcessAssociation = { init: function (options) {
    var box = document.getElementById('processAssociation');
    var title = document.getElementById('processAppName'), saved = document.getElementById('processSaved');
    var status = document.getElementById('processStatus'), list = document.getElementById('processList');
    var search = document.getElementById('processSearch'), refresh = document.getElementById('processRefresh');
    var bind = document.getElementById('processBind'), unbind = document.getElementById('processUnbind');
    var active = null, generation = 0, controller = null, rows = [], snapshotId = '', expiresAt = 0;
    var selected = '', loading = false, saving = false;
    function text(message) { status.textContent = message; }
    function identity() {
      var association = active && active.processAssociation;
      saved.textContent = active && active.processAssociationError ? '无法读取已保存的关联：' + active.processAssociationError : association ? '已保存：' + association.name + ' · ' + (association.mode === 'path' ? '完整路径匹配' : '进程名匹配') : '尚未关联进程';
    }
    function controls() {
      search.disabled = loading || saving;
      refresh.disabled = loading || saving;
      bind.disabled = loading || saving || !selected;
      unbind.disabled = loading || saving || !(active && active.processAssociation);
      list.querySelectorAll('input').forEach(function (input) { input.disabled = saving; });
      document.getElementById('processClose').disabled = saving;
      box.setAttribute('aria-busy', String(loading || saving));
    }
    function render() {
      list.textContent = '';
      var word = search.value.trim().toLowerCase();
      var visible = rows.filter(function (row) { return [row.name, row.path, row.pid].join(' ').toLowerCase().indexOf(word) !== -1; });
      visible.forEach(function (row) {
        var label = document.createElement('label'); label.className = 'process-row';
        var input = document.createElement('input'); input.type = 'radio'; input.name = 'processSelection'; input.value = row.selectionId; input.checked = selected === row.selectionId;
        input.addEventListener('change', function () { selected = row.selectionId; controls(); });
        var details = document.createElement('span'), name = document.createElement('b'), path = document.createElement('small');
        name.textContent = row.name + ' · PID ' + row.pid;
        path.textContent = row.pathReadable && row.path ? row.path : '路径不可读取 · 将按进程名匹配';
        details.appendChild(name); details.appendChild(path); label.appendChild(input); label.appendChild(details); list.appendChild(label);
      });
      if (!loading && !visible.length) {
        var empty = document.createElement('p'); empty.textContent = rows.length ? '没有匹配的进程' : '暂无可关联的运行进程'; list.appendChild(empty);
      }
      controls();
    }
    function close() {
      if (saving) return;
      generation++; if (controller) controller.abort(); controller = null;
      active = null; box.hidden = true; rows = []; selected = ''; loading = false;
      var returnButton = document.querySelector('[data-associate][aria-expanded="true"]');
      document.querySelectorAll('[data-associate]').forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
      if (returnButton) returnButton.focus({preventScroll:true});
    }
    function load() {
      if (!active || saving) return;
      var token = options.getToken();
      if (!token) { text('请先在设置中填写访问令牌，再刷新进程列表。'); rows = []; selected = ''; render(); return; }
      if (controller) controller.abort();
      controller = new AbortController(); var requestController = controller, signal = controller.signal;
      var version = ++generation, timedOut = false;
      var timer = window.setTimeout(function () { timedOut = true; requestController.abort(); }, 15000);
      loading = true; rows = []; selected = ''; snapshotId = ''; text('正在读取电脑上的实际进程…'); render();
      fetch('/api/processes', {headers:{'X-NERV-Token':token},signal:signal,cache:'no-store'}).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (result) {
          if (!response.ok || result.ok !== true) throw new Error(response.status === 401 || response.status === 403 ? '访问令牌无效，请在设置中更新后重试。' : result.message || '读取进程失败，请重试。');
          return result;
        });
      }).then(function (result) {
        if (version !== generation || !active) return;
        rows = result.processes || []; snapshotId = result.snapshotId; expiresAt = typeof result.expiresAt === 'number' ? result.expiresAt : Date.parse(result.expiresAt);
        loading = false; text('选择要关联的进程。'); render();
      }).catch(function (error) {
        if (version !== generation || !active) return;
        loading = false; text(timedOut ? '读取超时，请刷新重试。' : error.message || '读取进程失败，请刷新重试。'); render();
      }).then(function () { window.clearTimeout(timer); if (version === generation) controller = null; });
    }
    function mutate(action) {
      if (!active || loading || saving || options.isSorting()) return;
      if (!options.getToken()) { text('请先在设置中填写访问令牌。'); return; }
      if (action === 'bind' && (!selected || !snapshotId)) return;
      if (action === 'bind' && expiresAt && Date.now() >= expiresAt) { selected = ''; controls(); text('进程列表已过期，请刷新后重新选择。'); return; }
      var id = active.id, version = generation;
      var body = {action:action,id:id};
      if (action === 'bind') { body.snapshotId = snapshotId; body.selectionId = selected; }
      saving = true; text(action === 'bind' ? '正在保存关联…' : '正在解除关联…'); controls();
      options.post('/api/apps/process-association', body).then(function (result) {
        options.onSaved(id, result.processAssociation || null);
        if (version !== generation || !active || active.id !== id) return;
        active.processAssociation = result.processAssociation || null; active.processAssociationError = '';
        identity(); text(action === 'bind' ? '关联已保存。' : '关联已解除。');
      }).catch(function (error) {
        if (version !== generation || !active) return;
        // A rejected selection must never be silently retried against another process.
        selected = ''; snapshotId = ''; text('操作失败：' + error.message + '；请检查令牌或刷新进程后重试。');
      }).then(function () { saving = false; controls(); });
    }
    document.getElementById('processClose').addEventListener('click', close);
    document.getElementById('processSettings').addEventListener('click', options.openSettings);
    refresh.addEventListener('click', load); search.addEventListener('input', render);
    bind.addEventListener('click', function () { mutate('bind'); }); unbind.addEventListener('click', function () { mutate('unbind'); });
    box.addEventListener('keydown', function (event) { event.stopPropagation(); if (event.key === 'Escape') close(); });
    return {open:function (app) {
      if (saving || options.isSorting()) return;
      document.querySelectorAll('[data-associate]').forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
      active = Object.assign({}, app); title.textContent = app.name; box.hidden = false; search.value = ''; identity(); load();
      box.scrollIntoView({block:'nearest',behavior:'instant'});
    }, close:close};
  }};
})(window);
