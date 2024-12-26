import React from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { act } from 'react-dom/test-utils'

// Add providers here as your app grows
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      {children}
    </>
  )
}

const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

// re-export everything
export * from '@testing-library/react'
export { act } from 'react'
export { customRender as render }