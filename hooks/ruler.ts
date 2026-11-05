// Measures the row the orb is drawn on. The hooks module can't: its viewport is
// the transcript's width, which a docked pane narrows, and this row runs beneath
// the pane. This draws nothing and posts the row's width whenever it changes.

import type { ClientModule } from 'claude-code'

const Ruler: ClientModule<null, number> = (_, surface) => {
  if (surface.columns !== surface.state) {
    surface.setState(surface.columns)
    surface.post(surface.columns)
  }
  return surface.elements.Box({})
}

export default Ruler
