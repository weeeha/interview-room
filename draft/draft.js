// Draft helper: reads ?state= and sets data-state on <body>.
// Valid states: default, empty, loading, error, long. Anything else falls back to default.
(function () {
  var valid = ['default', 'empty', 'loading', 'error', 'long'];
  var asked = new URLSearchParams(location.search).get('state');
  var state = valid.indexOf(asked) >= 0 ? asked : 'default';
  document.body.setAttribute('data-state', state);

  // Mark the matching link in the state list.
  document.querySelectorAll('.draft-states a[data-state-link]').forEach(function (a) {
    if (a.getAttribute('data-state-link') === state) a.setAttribute('aria-current', 'true');
  });

  // Retry in the draft just reloads the default state.
  document.querySelectorAll('[data-retry]').forEach(function (b) {
    b.addEventListener('click', function () { location.search = ''; });
  });
})();
