/**
 * ccweb-plugin-sdk.js
 *
 * Plugin-side SDK for communicating with ccweb host via postMessage bridge.
 * Include this script in your plugin's index.html:
 *   <script src="/plugin-sdk/ccweb-plugin-sdk.js"></script>
 *
 * Then use: window.ccweb.getSystemInfo(), window.ccweb.getProjectList(), etc.
 */
(function () {
  'use strict';

  let _callId = 0;
  const _pending = new Map(); // callId → { resolve, reject }

  // Listen for bridge responses from host
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || !data.callId) return;
    var entry = _pending.get(data.callId);
    if (!entry) return;
    _pending.delete(data.callId);
    if (data.error) {
      entry.reject(new Error(data.error));
    } else {
      entry.resolve(data.result);
    }
  });

  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'sdk_' + (++_callId);
      _pending.set(id, { resolve: resolve, reject: reject });

      // Timeout after 10s
      setTimeout(function () {
        if (_pending.has(id)) {
          _pending.delete(id);
          reject(new Error('Bridge timeout: ' + method));
        }
      }, 10000);

      window.parent.postMessage({
        callId: id,
        method: method,
        args: args || {},
      }, '*');
    });
  }

  window.ccweb = {
    /**
     * Get system info (CPU, memory, uptime, etc.)
     * Requires permission: system:info
     */
    getSystemInfo: function () {
      return rpc('system:info');
    },

    /**
     * Get list of all projects
     * Requires permission: project:list
     */
    getProjectList: function () {
      return rpc('project:list');
    },

    /**
     * Get status of a specific project
     * Requires permission: project:status
     * @param {string} projectId
     */
    getProjectStatus: function (projectId) {
      return rpc('project:status', { projectId: projectId });
    },

    /**
     * Send data to a project's terminal
     * Requires permission: terminal:send
     * @param {string} projectId
     * @param {string} data - text to send (use \r for Enter)
     */
    sendTerminal: function (projectId, data) {
      return rpc('terminal:send', { projectId: projectId, data: data });
    },

    /**
     * Read session history for a project
     * Requires permission: session:read
     * @param {string} projectId
     */
    getSessionHistory: function (projectId) {
      return rpc('session:read', { projectId: projectId });
    },

    /**
     * Read plugin's private persistent storage
     * Requires permission: storage:self (implicit)
     */
    getStorage: function () {
      return rpc('storage:get');
    },

    /**
     * Write plugin's private persistent storage
     * Requires permission: storage:self (implicit)
     * @param {object} data - JSON-serializable object
     */
    setStorage: function (data) {
      return rpc('storage:set', data);
    },

    /**
     * Call plugin's own backend API
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} path - relative path (e.g. "/status")
     * @param {object} [body] - request body for POST/PUT
     */
    backendApi: function (method, path, body) {
      return rpc('backend:api', { method: method, path: path, body: body });
    },
  };
})();
