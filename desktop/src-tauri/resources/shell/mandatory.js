/** Blocking update window: read the release facts, then dismiss. */
const error = document.getElementById('error')
const notes = document.getElementById('notes')

/** @param {string} id - element whose text carries one release fact. */
const field = (id) => document.getElementById(id)

let viewed

/**
 * Render whatever the shell last read from the release feed.
 * @param {object} view - installed, latest, notes, page and minimum facts.
 */
function render(view) {
  viewed = view
  field('installed').textContent = view.installed ?? '—'
  field('minimum').textContent = view.minimum ?? '—'
  field('latest').textContent = view.latest ?? '—'
  notes.textContent = view.notes ?? ''
}

/** Show one failure; the window stays open because dismissing is the user's act. */
function fail(cause) {
  error.hidden = false
  error.textContent = `无法读取更新信息：${cause}`
}

/**
 * Dismiss this window, optionally opening the release page first.
 * @param {boolean} openPage - whether to hand the release page to the browser.
 */
async function dismiss(openPage) {
  const minimum = viewed?.minimum
  if (typeof minimum !== 'string') return
  try {
    await window.dshMandatory.dismiss(minimum, openPage)
  } catch (cause) {
    fail(cause)
  }
}

document.getElementById('download').addEventListener('click', () => { void dismiss(true) })
document.getElementById('ack').addEventListener('click', () => { void dismiss(false) })

window.dshMandatory.state().then(render, fail)
