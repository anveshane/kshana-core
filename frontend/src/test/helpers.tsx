import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { AppStateContext, AppDispatchContext, initialState, type AppState, type AppAction } from '../lib/store'

interface WrapperOptions {
  state?: Partial<AppState>
  dispatch?: React.Dispatch<AppAction>
}

export function renderWithState(
  ui: ReactElement,
  options: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { state: stateOverrides, dispatch, ...renderOptions } = options
  const mockState = { ...initialState, ...stateOverrides }
  const mockDispatch = dispatch || (() => {})

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AppStateContext.Provider value={mockState}>
        <AppDispatchContext.Provider value={mockDispatch}>
          {children}
        </AppDispatchContext.Provider>
      </AppStateContext.Provider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    mockState,
    mockDispatch,
  }
}
