import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('SecureVault app', () => {
  it('starts at the first-run setup screen without persisted device linkage', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Create your secure vault' })).toBeInTheDocument()
    expect(screen.getByText(/Master Password is the only key/i)).toBeInTheDocument()
  })
})
