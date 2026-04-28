import { test, expect } from '@playwright/test'

test.describe('Select Existing Project', () => {
  test('selecting a project loads todos and shows in header', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000) // Wait for WS connection

    // Open project dropdown
    await page.click('text=Select Project...')
    await page.waitForTimeout(500)

    // Should show project list
    const projects = page.locator('button:has-text("lazarus_drive"), button:has-text("air_already")')
    const count = await projects.count()
    expect(count).toBeGreaterThan(0)

    // Select first project
    const firstProject = projects.first()
    const projectName = await firstProject.textContent()
    await firstProject.click()
    await page.waitForTimeout(2000)

    // Header should show project name
    await expect(page.locator(`text=${projectName?.split(' ')[0]}`).first()).toBeVisible()

    // Sidebar should have todos (completed items with ✓)
    await expect(page.locator('text=✓').first()).toBeVisible({ timeout: 5000 })
  })

  test('selecting a project clears previous chat messages', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    // Type something to create a chat message
    await page.fill('input[type=text]', '/help')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(500)

    // Should have help text in chat
    await expect(page.locator('text=Available Commands')).toBeVisible()

    // Select a project — should clear the chat
    await page.click('text=Select Project...')
    await page.waitForTimeout(500)
    const projectBtn = page.locator('[class*="hover:bg-surface"]').first()
    if (await projectBtn.isVisible()) {
      await projectBtn.click()
      await page.waitForTimeout(1000)
      // Help text should be gone
      await expect(page.locator('text=Available Commands')).not.toBeVisible()
    }
  })
})

test.describe('Create New Project via /new', () => {
  test('shows template selection cards with images', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/new')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(1000)

    // Should show template cards
    await expect(page.locator('text=Choose a template:')).toBeVisible()
    await expect(page.locator('text=Narrative Story Video')).toBeVisible()
    await expect(page.locator('text=Documentary Video')).toBeVisible()

    // Template images should be present
    const images = page.locator('img[src*="template_"]')
    expect(await images.count()).toBeGreaterThan(0)
  })

  test('clicking template shows style selection with images', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/new')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(1000)

    await page.click('text=Narrative Story Video')
    await page.waitForTimeout(500)

    // Should show style cards
    await expect(page.locator('text=Cinematic Realism')).toBeVisible()
    await expect(page.locator('text=Anime')).toBeVisible()

    // Style images should be present
    const images = page.locator('img[src*="style_"]')
    expect(await images.count()).toBeGreaterThan(0)

    // Selection should persist in chat
    await expect(page.locator('text=Selected template')).toBeVisible()
  })

  test('full wizard flow ends with description prompt', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    // Step 1: /new
    await page.fill('input[type=text]', '/new')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(1000)

    // Step 2: Select template
    await page.click('text=Narrative Story Video')
    await page.waitForTimeout(500)

    // Step 3: Select style
    await page.click('text=Cinematic Realism')
    await page.waitForTimeout(500)

    // Step 4: Select duration
    await page.click('text=1 minute')
    await page.waitForTimeout(500)

    // Should show prompt to describe project
    await expect(page.locator('text=describe your video project')).toBeVisible()

    // Chat input placeholder should change
    const input = page.locator('input[type=text]')
    await expect(input).toHaveAttribute('placeholder', /[Dd]escribe/)

    // All selections should be in chat history
    await expect(page.locator('text=Selected template')).toBeVisible()
    await expect(page.locator('text=Selected style')).toBeVisible()
    await expect(page.locator('text=Selected duration')).toBeVisible()
  })
})

test.describe('Command System', () => {
  test('/help shows available commands', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/help')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(500)

    await expect(page.locator('text=Available Commands')).toBeVisible()
    await expect(page.locator('text=/new')).toBeVisible()
    await expect(page.locator('text=/workflows')).toBeVisible()
  })

  test('/workflows opens the workflow modal', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/workflows')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(500)

    await expect(page.locator('text=Workflow Management')).toBeVisible()
  })

  test('/providers opens the provider modal', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/providers')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(500)

    await expect(page.locator('text=Provider Settings')).toBeVisible()
  })

  test('unknown command shows error', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/doesnotexist')
    await page.press('input[type=text]', 'Enter')
    await page.waitForTimeout(500)

    await expect(page.locator('text=Unknown command')).toBeVisible()
  })

  test('/ shows autocomplete suggestions', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    await page.fill('input[type=text]', '/')
    await page.waitForTimeout(300)

    // Autocomplete panel should appear
    await expect(page.locator('text=/help').first()).toBeVisible()
    await expect(page.locator('text=/new').first()).toBeVisible()
  })
})
