import { expect, test, type Browser, type Page } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Obj { id: string; type: string; layerId: string; x: number; y: number; width: number; height: number }

async function newTable(page: Page): Promise<{ tableId: string; gmSecret: string }> {
  const res = await page.request.post('/api/tables', { data: { name: 'E2E' } })
  expect(res.status()).toBe(201)
  return res.json()
}

const waitOpen = (page: Page) =>
  page.waitForFunction(() => (window as any).__mesa?.getState().status === 'open')

const objects = (page: Page): Promise<Obj[]> =>
  page.evaluate(() => Object.values((window as any).__mesa.getState().objects))

async function open(browser: Browser, path: string, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(path)
  await page.getByLabel('Seu apelido').fill(nickname)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await waitOpen(page)
  return page
}

async function uploadToken(page: Page): Promise<void> {
  const loaded = page.waitForResponse((r) => r.url().includes('/files/') && r.ok())
  await page.getByTestId('image-input').setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer: PNG })
  await loaded
  await page.waitForTimeout(200) // imagem desenhada → área clicável pronta
}

test('token arrastado pelo mestre se move na tela do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)

  const [token] = await objects(gm)
  const cx = token.x + token.width / 2
  const cy = token.y + token.height / 2
  await gm.mouse.move(cx, cy)
  await gm.mouse.down()
  await gm.mouse.move(cx + 100, cy + 50, { steps: 10 })
  await gm.mouse.up()

  await expect.poll(async () => Math.round((await objects(player))[0].x)).toBe(Math.round(token.x + 100))
})

test('jogador não vê a camada do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await expect(player.getByLabel('Camada ativa').locator('option')).toHaveCount(3)
  await gm.getByLabel('Camada ativa').selectOption('gm')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)
})

test('desenho aparece para o outro, persiste após recarregar e Ctrl+Z desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByLabel('Camada ativa').selectOption('drawings')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(300, 300)
  await player.mouse.down()
  await player.mouse.move(400, 350, { steps: 10 })
  await player.mouse.move(450, 300, { steps: 10 })
  await player.mouse.up()

  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)

  await player.reload()
  await waitOpen(player)
  expect((await objects(player)).filter((o) => o.type === 'stroke')).toHaveLength(1)

  // a pilha de desfazer é por sessão: desenhar de novo e desfazer
  await player.getByLabel('Camada ativa').selectOption('drawings')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(500, 400)
  await player.mouse.down()
  await player.mouse.move(600, 450, { steps: 5 })
  await player.mouse.up()
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(2)
  await player.waitForFunction(() => {
    const s = (window as any).__mesa.getState()
    return Object.keys(s.pending).length === 0 && s.undoStack.length > 0
  })
  await player.keyboard.press('Control+z')
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)
})

test('link de mesa inexistente mostra aviso', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/t/ZZZZZZZZZZ')
  await page.getByLabel('Seu apelido').fill('Ana')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Mesa não encontrada.')).toBeVisible()
})

test('botão direito na caneta abre opções; modo Apagar vira Borracha (E)', async ({ browser, page }) => {
  const { tableId } = await newTable(page)
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByRole('button', { name: 'Lápis (P)' }).click({ button: 'right' })
  const pop = player.getByRole('dialog', { name: 'Opções da caneta' })
  await expect(pop).toBeVisible()
  await pop.getByLabel('Espessura do traço').fill('12')
  await pop.getByRole('button', { name: 'Cor #4363d8' }).click()
  await pop.getByRole('button', { name: 'Apagar' }).click()
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(pop.getByText('Só os meus')).toHaveCount(0) // a chave é só do mestre

  await player.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await player.keyboard.press('p')
  await expect(player.getByRole('button', { name: 'Lápis (P)' })).toHaveAttribute('aria-pressed', 'true')
  await player.keyboard.press('e')
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toBeVisible()

  const s = await player.evaluate(() => {
    const st = (window as any).__mesa.getState()
    return { strokeWidth: st.strokeWidth, color: st.color }
  })
  expect(s).toEqual({ strokeWidth: 12, color: '#4363d8' })
})
