import { expect, test, type Browser, type Page } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Obj {
  id: string
  type: string
  layerId: string
  x: number
  y: number
  width: number
  height: number
  title?: string
  segments?: number[][]
  control: { mode: string; clientIds: string[] }
}

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

async function openObjectMenu(page: Page, obj: Obj) {
  await page.mouse.click(obj.x + obj.width / 2, obj.y + obj.height / 2, { button: 'right' })
  const menu = page.getByRole('dialog', { name: 'Menu do objeto' })
  await expect(menu).toBeVisible()
  return menu
}

async function dragObject(page: Page, obj: Obj, dx: number, dy: number): Promise<void> {
  const cx = obj.x + obj.width / 2
  const cy = obj.y + obj.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 })
  await page.mouse.up()
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

test('título aparece para o jogador; anotação do mestre não chega a ele', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  const menu = await openObjectMenu(gm, token)
  await menu.getByLabel('Título').fill('Goblin')
  await menu.getByLabel('Título').press('Enter')
  await menu.getByLabel('Anotação do mestre').fill('tem 3 PV')
  await menu.getByLabel('Anotação do mestre').blur()

  await expect.poll(async () => (await objects(player))[0].title).toBe('Goblin')
  await expect.poll(() => gm.evaluate(() => (window as any).__mesa.getState().notes)).toEqual({ [token.id]: 'tem 3 PV' })
  await player.waitForTimeout(500)
  const playerState = await player.evaluate(() => {
    const s = (window as any).__mesa.getState()
    return JSON.stringify({ objects: s.objects, notes: s.notes })
  })
  expect(playerState).not.toContain('tem 3 PV')
})

test('mestre move token da camada Mestre para Tokens; jogador passa a vê-lo no mesmo lugar', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(gm, 'Mestre')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)

  const [token] = await objects(gm)
  const menu = await openObjectMenu(gm, token)
  await menu.getByRole('button', { name: 'Mover para camada' }).click()
  await expect(menu.getByRole('button', { name: 'Mestre', exact: true })).toHaveCount(0) // a atual não aparece
  await menu.getByRole('button', { name: 'Tokens', exact: true }).click()
  await expect(menu).toHaveCount(0)

  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [seen] = await objects(player)
  expect(seen).toMatchObject({ id: token.id, layerId: 'tokens', x: token.x, y: token.y, width: token.width, height: token.height })
})

test('token "só o mestre": o arrasto do jogador não move o token na tela do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  // Primeiro libera para todos e confirma que o arrasto do jogador funciona…
  let menu = await openObjectMenu(gm, token)
  await menu.getByLabel('Todos').check()
  await gm.keyboard.press('Escape')
  await expect.poll(async () => (await objects(player))[0].control.mode).toBe('all')
  await dragObject(player, token, 100, 0)
  await expect.poll(async () => Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x + 100))

  // …depois restringe ao mestre: o arrasto do jogador não tem efeito.
  const [moved] = await objects(gm)
  menu = await openObjectMenu(gm, moved)
  await menu.getByLabel('Só o mestre').check()
  await gm.keyboard.press('Escape')
  await expect.poll(async () => (await objects(player))[0].control.mode).toBe('gm')
  await dragObject(player, moved, 0, 120)
  await player.waitForTimeout(500)
  expect(Math.round((await objects(gm))[0].y)).toBe(Math.round(moved.y))
  expect(Math.round((await objects(player))[0].y)).toBe(Math.round(moved.y))
})

test('passada de borracha no meio de uma linha deixa 2 pedaços na tela do outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(300, 300)
  await player.mouse.down()
  await player.mouse.move(600, 300, { steps: 10 })
  await player.mouse.up()
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)

  await player.keyboard.press('e')
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toBeVisible()
  await player.mouse.move(450, 250)
  await player.mouse.down()
  await player.mouse.move(450, 350, { steps: 10 })
  await player.mouse.up()

  await expect.poll(async () => (await objects(gm)).find((o) => o.type === 'stroke')?.segments?.length).toBe(2)
})

test('mestre remove da lista um membro offline', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const observer = await open(browser, `/t/${tableId}?debug=1`, 'Bia')
  const row = (page: Page, name: string) =>
    page.locator('.members li').filter({ hasText: new RegExp(`^\\s*${name}(?![\\p{L}\\d])`, 'u') })
  const anaRow = row(gm, 'Ana')
  const anaRowSeenByBia = row(observer, 'Ana')

  await expect(anaRow).toBeVisible()
  await expect(anaRowSeenByBia).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Remover Ana da lista' })).toHaveCount(0) // online: sem X
  await player.context().close()

  const remove = gm.getByRole('button', { name: 'Remover Ana da lista' })
  await expect(remove).toBeVisible()
  await remove.click()
  await expect(anaRow).toHaveCount(0)
  await expect(anaRowSeenByBia).toHaveCount(0) // propagou sem recarregar

  await gm.reload()
  await waitOpen(gm)
  await expect(row(gm, 'Mestre')).toBeVisible()
  await expect(anaRow).toHaveCount(0)
})

// ---------------------------------------------------------------- M3

const chatEntries = (page: Page) => page.locator('section[aria-label="Chat"] .chat-entry')

const memberRow = (page: Page, name: string) =>
  page.locator('.members li').filter({ hasText: new RegExp(`^\\s*${name}(?![\\p{L}\\d])`, 'u') })

const chatState = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const s = (window as any).__mesa.getState()
    return JSON.stringify({ table: s.chatTable, dms: s.chatDms, tabs: s.chatTabs })
  })

async function memberMenu(page: Page, name: string) {
  await memberRow(page, name).click({ button: 'right' })
  const menu = page.getByRole('dialog', { name: `Ações para ${name}` })
  await expect(menu).toBeVisible()
  return menu
}

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 8 })
  await page.mouse.up()
}

const DICE_BUTTON = 'Rolar 1d20 (botão direito: mais opções)'

test('clique no dado rola 1d20 e aparece no chat do outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByRole('button', { name: DICE_BUTTON }).click()
  await expect(chatEntries(gm)).toHaveCount(1)
  await expect(chatEntries(gm).first()).toContainText('Ana rolou 1d20: [')
  await expect(chatEntries(player)).toHaveCount(1)
})

test('rolagem secreta do mestre não aparece para o jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.getByRole('button', { name: DICE_BUTTON }).click({ button: 'right' })
  const modal = gm.getByRole('dialog', { name: 'Rolar dados' })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'd6', exact: true }).click()
  await modal.getByLabel('Só o mestre vê').check()
  await modal.getByRole('button', { name: 'Rolar', exact: true }).click()
  await expect(modal).toHaveCount(0)

  await expect(chatEntries(gm)).toHaveCount(1)
  await expect(chatEntries(gm).first()).toContainText('rolou 1d6')
  await expect(chatEntries(gm).first()).toContainText('(só mestre)')
  await player.waitForTimeout(500)
  await expect(chatEntries(player)).toHaveCount(0)
  expect(await chatState(player)).not.toContain('"secret":true')
})

test('conversa privada chega só ao destinatário; o mestre não recebe; fechar a aba apaga', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')

  await expect(memberRow(ana, 'Bia')).toBeVisible()
  await (await memberMenu(ana, 'Bia')).getByRole('button', { name: 'Conversa privada' }).click()
  await expect(ana.getByRole('tab', { name: /^Bia/ })).toHaveAttribute('aria-selected', 'true')
  await ana.getByLabel('Mensagem', { exact: true }).fill('segredo entre nós')
  await ana.getByLabel('Mensagem', { exact: true }).press('Enter')
  await expect(chatEntries(ana).last()).toContainText('segredo entre nós')

  // Bia: a aba aparece sem tirar o foco da Mesa, com contador de não lidas.
  const tabAna = bia.getByRole('tab', { name: /^Ana/ })
  await expect(tabAna).toBeVisible()
  await expect(tabAna).toHaveAttribute('aria-selected', 'false')
  await expect(tabAna.locator('.badge')).toHaveText('1')
  await expect(bia.getByRole('tab', { name: /^Mesa/ })).toHaveAttribute('aria-selected', 'true')
  await tabAna.click()
  await expect(chatEntries(bia).last()).toContainText('segredo entre nós')

  // O mestre não participa: nada chega a ele.
  await gm.waitForTimeout(500)
  await expect(gm.getByRole('tab')).toHaveCount(1)
  expect(await chatState(gm)).not.toContain('segredo')

  // Fechar a aba apaga o histórico; reabrir começa vazia.
  await bia.getByRole('button', { name: 'Fechar conversa com Ana' }).click()
  await expect(tabAna).toHaveCount(0)
  expect(await chatState(bia)).not.toContain('segredo')
  await (await memberMenu(bia, 'Ana')).getByRole('button', { name: 'Conversa privada' }).click()
  await expect(bia.getByRole('tab', { name: /^Ana/ })).toHaveAttribute('aria-selected', 'true')
  await expect(chatEntries(bia)).toHaveCount(0)
})

test('imagem enviada no chat aparece no outro cliente', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const uploaded = player.waitForResponse((r) => r.url().includes('/assets') && r.status() === 201)
  await player.getByTestId('chat-image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
  await uploaded
  const img = chatEntries(gm).locator('img')
  await expect(img).toHaveCount(1)
  await expect(img).toHaveAttribute('src', /^\/files\/[a-f0-9]{64}$/)
})

test('mestre liga grade e encaixe: token solto cai alinhado na tela do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.getByRole('button', { name: 'Grade', exact: true }).click()
  const pop = gm.getByRole('dialog', { name: 'Grade' })
  await pop.getByLabel('Mostrar grade').check()
  await pop.getByLabel('Encaixar imagens na grade').check()
  await gm.keyboard.press('Escape')
  await expect
    .poll(() => player.evaluate(() => (window as any).__mesa.getState().settings.grid))
    .toEqual({ enabled: true, size: 70, snap: true })

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)
  // centro da tela (640, 360) − 35 → (605, 325) → encaixado em (630, 350)
  expect(token).toMatchObject({ x: 630, y: 350, width: 70, height: 70 })

  await dragObject(gm, token, 100, 50)
  await expect
    .poll(async () => {
      const [o] = await objects(player)
      return [o.x, o.y]
    })
    .toEqual([700, 420])
})

test('régua do mestre aparece para o jogador com nome e distância', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const labels = () => player.evaluate(() => (window as any).__stage.find('.ruler-label').map((n: any) => n.text()))

  await gm.getByRole('button', { name: 'Régua (R)' }).click()
  await gm.mouse.click(400, 300) // início no centro do quadrado (385, 315)
  await gm.mouse.move(700, 300, { steps: 10 })
  await expect.poll(labels).toEqual(['Mestre · 4,5 q'])

  await gm.keyboard.press('Escape')
  await expect.poll(labels).toEqual([])
})

test('retângulo, elipse e linha aparecem para o outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const drawShape = async (label: string, from: [number, number], to: [number, number]) => {
    await gm.getByRole('button', { name: 'Formas (S)' }).click({ button: 'right' })
    const pop = gm.getByRole('dialog', { name: 'Opções das formas' })
    await pop.getByRole('button', { name: label }).click()
    await gm.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await dragOnCanvas(gm, from, to)
  }
  await drawShape('Retângulo', [200, 450], [300, 520])
  await drawShape('Elipse', [350, 450], [450, 520])
  await drawShape('Linha', [500, 450], [600, 520])

  await expect
    .poll(async () =>
      (await objects(player))
        .filter((o) => o.type === 'shape')
        .map((o) => (o as Obj & { kind: string }).kind)
        .sort(),
    )
    .toEqual(['ellipse', 'line', 'rect'])
})

test('Ctrl + clique do mestre centraliza a câmera do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.keyboard.down('Control')
  await gm.mouse.click(900, 500)
  await gm.keyboard.up('Control')

  // tela 1280×720: o ponto (900, 500) vai para o centro (640, 360), zoom mantido
  await expect
    .poll(() =>
      player.evaluate(() => {
        const v = (window as any).__mesa.getState().viewport
        return [Math.round(v.x), Math.round(v.y), v.scale]
      }),
    )
    .toEqual([-260, -140, 1])
  expect(await gm.evaluate(() => (window as any).__mesa.getState().viewport)).toEqual({ x: 0, y: 0, scale: 1 })
})

test('mestre renomeia o jogador: muda na tela dele e persiste ao recarregar', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const menu = await memberMenu(gm, 'Ana')
  await menu.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await menu.getByLabel('Apelido').fill('Aninha')
  await menu.getByRole('button', { name: 'Salvar' }).click()
  await expect(menu).toHaveCount(0)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')

  await player.reload()
  await waitOpen(player)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')
  await expect(memberRow(gm, 'Aninha')).toBeVisible()
})
