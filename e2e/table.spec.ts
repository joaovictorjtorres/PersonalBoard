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

const layersPanel = (page: Page) => page.getByRole('region', { name: 'Camadas' })

const layerRow = (page: Page, name: string) =>
  layersPanel(page).locator('.layer-row').filter({ hasText: new RegExp(`^${name}$`) })

async function selectLayer(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click()
}

async function openLayerMenu(page: Page, name: string) {
  await layerRow(page, name).click({ button: 'right' })
  const menu = page.getByRole('dialog', { name: 'Propriedades da camada' })
  await expect(menu).toBeVisible()
  return menu
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

  await expect(layersPanel(gm).locator('.layer-row')).toHaveText(['Mestre', 'Desenhos', 'Tokens', 'Mapa'])
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])
  await selectLayer(gm, 'Mestre')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)
})

test('desenho aparece para o outro, persiste após recarregar e Ctrl+Z desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(player, 'Desenhos')
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
  await selectLayer(player, 'Desenhos')
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

test('mestre esconde e revela uma camada; jogador vê os objetos sumirem e voltarem', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)

  const menu = await openLayerMenu(gm, 'Tokens')
  await menu.getByLabel('Oculta para jogadores').check()
  await expect.poll(async () => (await objects(player)).length).toBe(0)
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Mapa'])

  await menu.getByLabel('Oculta para jogadores').uncheck()
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])
})

test('nova camada entra abaixo do Mestre; subir/descer respeita os limites', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await layersPanel(gm).getByRole('button', { name: 'Nova camada', exact: true }).first().click()
  await expect(layersPanel(gm).locator('.layer-row')).toHaveText(['Mestre', 'Nova camada', 'Desenhos', 'Tokens', 'Mapa'])
  await expect(layerRow(gm, 'Nova camada')).toHaveAttribute('aria-pressed', 'true')
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Nova camada', 'Desenhos', 'Tokens', 'Mapa'])

  const menu = await openLayerMenu(gm, 'Nova camada')
  await expect(menu.getByRole('button', { name: 'Subir camada' })).toBeDisabled()
  await menu.getByRole('button', { name: 'Descer camada' }).click()
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Nova camada', 'Tokens', 'Mapa'])
  await menu.getByLabel('Nome').fill('Masmorra')
  await menu.getByLabel('Nome').press('Enter')
  await expect(layerRow(player, 'Masmorra')).toBeVisible()
  await gm.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  const gmMenu = await openLayerMenu(gm, 'Mestre')
  await expect(gmMenu.getByLabel('Travada para jogadores')).toBeVisible()
  await expect(gmMenu.getByLabel('Oculta para jogadores')).toHaveCount(0)
  await expect(gmMenu.getByRole('button', { name: 'Remover camada' })).toHaveCount(0)
  await expect(gmMenu.getByRole('button', { name: 'Subir camada' })).toHaveCount(0)
})
