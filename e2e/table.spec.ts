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
  ownerId: string
}

async function newTable(page: Page): Promise<{ tableId: string; gmSecret: string; playerKey: string }> {
  const res = await page.request.post('/api/tables', { data: { name: 'E2E' } })
  expect(res.status()).toBe(201)
  return res.json()
}

const waitOpen = (page: Page) =>
  page.waitForFunction(() => (window as any).__mesa?.getState().status === 'open')

/** Caminho do jogador: leva a chave da mesa (#j=). */
const playerPath = (t: { tableId: string; playerKey: string }) => `/t/${t.tableId}?debug=1#j=${t.playerKey}`

const selfId = (page: Page): Promise<string> => page.evaluate(() => (window as any).__mesa.getState().self.clientId)

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

/** Clica no lápis e afasta o mouse: o menu abre na hora ao passar o mouse e fecha quando ele sai. */
async function pickPencil(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lápis (P)' }).click()
  await page.mouse.move(900, 600)
  await expect(page.locator('.pen-popover')).toHaveCount(0)
}

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await expect(layersPanel(gm).locator('.layer-row')).toHaveText(['Mestre', 'Desenhos', 'Tokens', 'Mapa'])
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])
  await selectLayer(gm, 'Mestre')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)
})

test('desenho aparece para o outro, persiste após recarregar e Ctrl+Z desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await pickPencil(player)
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
  await pickPencil(player)
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
  const { tableId, playerKey } = await newTable(page)
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await player.getByRole('button', { name: 'Lápis (P)' }).click({ button: 'right' })
  const pop = player.getByRole('dialog', { name: 'Opções da caneta' })
  await expect(pop).toBeVisible()
  await pop.getByLabel('Espessura do traço').fill('12')
  await pop.getByRole('button', { name: 'Cor #4363d8' }).click()
  await expect(pop.getByLabel('Cor do traço (hex)')).toHaveValue('#4363d8')
  // seletor próprio (o nativo não abre no Brave): quadrado de saturação/brilho e campo hex
  await pop.getByRole('button', { name: 'Cor do traço: mais cores' }).click()
  const sv = pop.getByRole('slider', { name: 'Cor do traço: saturação e brilho' })
  const svBox = (await sv.boundingBox())!
  await player.mouse.click(svBox.x + 2, svBox.y + 2) // perto do canto superior esquerdo (branco)
  await expect.poll(() => player.evaluate(() => (window as any).__mesa.getState().color)).not.toBe('#4363d8')
  await sv.press('Shift+ArrowLeft') // teclado: saturação 0, brilho 100%
  await sv.press('Shift+ArrowUp')
  await expect.poll(() => player.evaluate(() => (window as any).__mesa.getState().color)).toBe('#ffffff')
  await pop.getByLabel('Cor do traço (hex)').fill('#12AB34')
  await expect(pop.getByRole('button', { name: 'Cor do traço: mais cores' })).toHaveCSS('background-color', 'rgb(18, 171, 52)')
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
  expect(s).toEqual({ strokeWidth: 12, color: '#12ab34' })
})

test('passar o mouse nas ferramentas abre o menu; atravessar o vão não fecha; sair fecha na hora; um aberto por vez', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const pen = gm.getByRole('dialog', { name: 'Opções da caneta' })
  const shape = gm.getByRole('dialog', { name: 'Opções das formas' })

  await gm.getByRole('button', { name: 'Lápis (P)' }).hover()
  await expect(pen).toBeVisible()
  // do botão até o popover, passando pelo vão de 12 px
  const btn = (await gm.getByRole('button', { name: 'Lápis (P)' }).boundingBox())!
  const box = (await pen.boundingBox())!
  await gm.mouse.move(box.x + 20, btn.y + btn.height / 2, { steps: 8 })
  await gm.waitForTimeout(400)
  await expect(pen).toBeVisible()
  await pen.getByRole('button', { name: 'Cor #4363d8' }).click()

  await gm.getByRole('button', { name: 'Formas (S)' }).hover()
  await expect(shape).toBeVisible()
  await expect(pen).toHaveCount(0)

  // sair do menu fecha na hora (sem atraso)
  await gm.mouse.move(800, 600)
  await expect(shape).toHaveCount(0, { timeout: 100 })

  await gm.getByRole('button', { name: 'Grade', exact: true }).hover()
  await expect(gm.getByRole('dialog', { name: 'Grade' })).toBeVisible()
  await expect(player.getByRole('button', { name: 'Grade', exact: true })).toHaveCount(0)
})

test('mestre esconde e revela uma camada; jogador vê os objetos sumirem e voltarem', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await pickPencil(player)
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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const observer = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')
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
  const dialog = confirmDialog(gm)
  await expect(dialog).toContainText('Excluir Ana da mesa?')
  await dialog.getByRole('button', { name: 'Excluir e manter as coisas' }).click()
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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await player.getByRole('button', { name: DICE_BUTTON }).click()
  await expect(chatEntries(gm)).toHaveCount(1)
  await expect(chatEntries(gm).first()).toContainText('Ana rolou 1d20: [')
  await expect(chatEntries(player)).toHaveCount(1)
})

test('rolagem secreta do mestre não aparece para o jogador', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')

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

  // Fechar a aba apaga o histórico; reabrir começa vazia. O X só aparece com o mouse em cima.
  const closeAna = bia.getByRole('button', { name: 'Fechar conversa com Ana' })
  await bia.mouse.move(0, 0)
  await expect(closeAna).toHaveCSS('opacity', '0')
  await tabAna.hover()
  await expect(closeAna).toHaveCSS('opacity', '1')
  await closeAna.click()
  await expect(tabAna).toHaveCount(0)
  expect(await chatState(bia)).not.toContain('segredo')
  await (await memberMenu(bia, 'Ana')).getByRole('button', { name: 'Conversa privada' }).click()
  await expect(bia.getByRole('tab', { name: /^Ana/ })).toHaveAttribute('aria-selected', 'true')
  await expect(chatEntries(bia)).toHaveCount(0)
})

test('botão direito no nome do chat: conversa privada; o mestre também edita apelido e cor', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')

  await ana.getByLabel('Mensagem', { exact: true }).fill('oi mesa')
  await ana.getByLabel('Mensagem', { exact: true }).press('Enter')
  await expect(chatEntries(bia).last()).toContainText('oi mesa')
  await expect(chatEntries(gm).last()).toContainText('oi mesa')

  // Jogador: só "Conversa privada".
  await chatEntries(bia).last().locator('.chat-author', { hasText: 'Ana' }).click({ button: 'right' })
  await expect(bia.getByRole('button', { name: 'Editar apelido e cor' })).toHaveCount(0)
  await bia.getByRole('button', { name: 'Conversa privada' }).click()
  await expect(bia.getByRole('tab', { name: /^Ana/ })).toHaveAttribute('aria-selected', 'true')

  // Mestre: pode editar pelo chat.
  await chatEntries(gm).last().locator('.chat-author', { hasText: 'Ana' }).click({ button: 'right' })
  await expect(gm.getByRole('button', { name: 'Conversa privada' })).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Editar apelido e cor' })).toBeVisible()

  // A própria mensagem: sem menu para jogador (não há conversa consigo mesmo).
  await expect(chatEntries(ana).last().locator('.chat-author')).toHaveCount(0)
})

test('imagem enviada no chat aparece no outro cliente', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  const uploaded = player.waitForResponse((r) => r.url().includes('/assets') && r.status() === 201)
  await player.getByTestId('chat-image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
  await uploaded
  const img = chatEntries(gm).locator('img')
  await expect(img).toHaveCount(1)
  await expect(img).toHaveAttribute('src', /^\/files\/[a-f0-9]{64}$/)
})

test('mestre liga grade e encaixe: token solto cai alinhado na tela do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await gm.getByRole('button', { name: 'Grade', exact: true }).click()
  const pop = gm.getByRole('dialog', { name: 'Grade' })
  await expect(pop.getByText('1 quadrado = 1 m')).toBeVisible()
  // mesa nova já vem com a grade ligada (sem encaixe)
  await expect(pop.getByLabel('Mostrar grade')).toBeChecked()
  await expect(pop.getByLabel('Encaixar imagens na grade')).not.toBeChecked()
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

test('título e ícone de anotação acompanham o token durante o arrasto; encaixe ao soltar', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  await uploadToken(gm)
  const [token] = await objects(gm)
  const menu = await openObjectMenu(gm, token)
  await menu.getByLabel('Título').fill('Goblin')
  await menu.getByLabel('Título').press('Enter')
  await menu.getByLabel('Anotação do mestre').fill('tem 3 PV')
  await menu.getByLabel('Anotação do mestre').blur()
  await gm.keyboard.press('Escape')
  await gm.evaluate(() => (window as any).__mesa.getState().actions.updateSettings({ grid: { snap: true } }))
  await expect.poll(async () => (await objects(gm))[0].title).toBe('Goblin')

  // posição do token (nó do Konva) e das decorações, relativa ao canto do token
  const deco = (id: string) =>
    gm.evaluate((id) => {
      const stage = (window as any).__stage
      const img = stage.findOne(`#${id}`)
      const title = stage.findOne('.object-title')
      const note = stage.findOne('.object-note')
      return {
        img: [img.x(), img.y()],
        title: [title.x() + title.width() / 2 - img.x(), title.y() - img.y()],
        note: [note.x() - img.x(), note.y() - img.y()],
      }
    }, id)
  const rel = { title: [35, 74], note: [63, -7] } // centro embaixo (+4 px) e canto de cima à direita
  expect(await deco(token.id)).toEqual({ img: [605, 325], ...rel })

  await gm.mouse.move(640, 360)
  await gm.mouse.down()
  await gm.mouse.move(740, 410, { steps: 10 })
  // no meio do arrasto (botão ainda apertado) as decorações já estão junto do token
  await expect.poll(() => deco(token.id)).toEqual({ img: [705, 375], ...rel })
  await gm.mouse.up()

  // ao soltar, encaixa na grade (705, 375) → (700, 350), e as decorações vão junto
  await expect.poll(() => deco(token.id)).toEqual({ img: [700, 350], ...rel })
  expect((await objects(gm))[0]).toMatchObject({ x: 700, y: 350 })
})

test('régua do mestre aparece para o jogador com nome e distância', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const labels = () => player.evaluate(() => (window as any).__stage.find('.ruler-label').map((n: any) => n.text()))

  await gm.getByRole('button', { name: 'Régua (R)' }).click()
  await gm.mouse.click(400, 300) // a distância conta do centro do quadrado (385, 315)…
  await gm.mouse.move(700, 300, { steps: 10 }) // …até o centro de (735, 315)
  await expect.poll(labels).toEqual(['Mestre · 5,0 m'])

  await gm.keyboard.press('Escape')
  await expect.poll(labels).toEqual([])
})

test('régua com dobra: botão direito dobra, o outro vê a linha quebrada com a soma', async ({ browser, page }) => {
  const { tableId, playerKey } = await newTable(page)
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')
  const seen = () =>
    bia.evaluate(() => {
      const stage = (window as any).__stage
      return {
        line: stage.find('.ruler-line').map((n: any) => n.points()),
        total: stage.find('.ruler-label').map((n: any) => n.text()),
        segments: stage.find('.ruler-segment-label').map((n: any) => n.text()),
      }
    })

  await ana.getByRole('button', { name: 'Régua (R)' }).click()
  // a linha passa exatamente pelos pontos apontados; a distância conta pelo centro dos quadrados
  await ana.mouse.click(400, 300) // quadrado de centro (385, 315)
  await ana.mouse.move(700, 300, { steps: 5 })
  await ana.mouse.click(700, 300, { button: 'right' }) // dobra; quadrado de centro (735, 315)
  await ana.mouse.move(740, 450, { steps: 5 }) // quadrado de centro (735, 455)
  await expect.poll(seen).toEqual({
    line: [[400, 300, 700, 300, 740, 450]],
    total: ['Ana · 7,0 m'],
    segments: ['5,0 m', '2,0 m'],
  })
  // o botão direito medindo não abre menu nenhum
  await expect(ana.getByRole('dialog')).toHaveCount(0)

  await ana.mouse.click(740, 450) // clique esquerdo termina e remove
  await expect.poll(seen).toEqual({ line: [], total: [], segments: [] })
})

test('retângulo, elipse e linha aparecem para o outro', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

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
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  const menu = await memberMenu(gm, 'Ana')
  await menu.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await menu.getByLabel('Apelido').fill('Aninha')
  await menu.getByLabel('Cor do membro (hex)').fill('#zzz')
  await expect(menu.getByLabel('Cor do membro (hex)')).toHaveAttribute('aria-invalid', 'true')
  await menu.getByLabel('Cor do membro (hex)').fill('#a1b2c3')
  await menu.getByRole('button', { name: 'Salvar' }).click()
  await expect(menu).toHaveCount(0)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')
  await expect
    .poll(() => player.evaluate(() => (window as any).__mesa.getState().self?.color))
    .toBe('#a1b2c3')

  await player.reload()
  await waitOpen(player)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')
  await expect(memberRow(gm, 'Aninha')).toBeVisible()
})

test('modais e menus cabem na janela 1280x720 sem rolagem', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)

  // modal de apelido, em um contexto novo
  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto(`/t/${tableId}?debug=1#j=${playerKey}`)
  await expect(fresh.getByLabel('Seu apelido')).toBeVisible()
  const noScroll = (loc: import('@playwright/test').Locator, name: string) =>
    loc.evaluate((el) => ({ w: el.scrollWidth <= el.clientWidth, h: el.scrollHeight <= el.clientHeight }))
      .then((r) => expect(r, name).toEqual({ w: true, h: true }))
  await noScroll(fresh.locator('.modal'), 'nickname')

  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  await expect(memberRow(gm, 'Ana')).toBeVisible()
  await expect(player.locator('.members')).toBeVisible()
  await uploadToken(gm)
  const [token] = await objects(gm)

  const dice = gm.getByRole('dialog', { name: 'Rolar dados' })
  await gm.getByRole('button', { name: DICE_BUTTON }).click({ button: 'right' })
  await expect(dice).toBeVisible()
  await noScroll(dice, 'dados')
  await gm.keyboard.press('Escape')

  await gm.getByRole('button', { name: 'Grade' }).click()
  const grid = gm.getByRole('dialog', { name: 'Grade' })
  await expect(grid).toBeVisible()
  await noScroll(grid, 'grade')
  await gm.keyboard.press('Escape')

  await gm.getByRole('button', { name: 'Lápis (P)' }).click({ button: 'right' })
  const pen = gm.getByRole('dialog', { name: 'Opções da caneta' })
  await expect(pen).toBeVisible()
  await pen.getByRole('button', { name: 'Apagar' }).click() // estado mais alto (escopo do mestre)
  await noScroll(pen, 'caneta')
  const penBox = await pen.boundingBox()
  expect(penBox && penBox.y >= 0 && penBox.y + penBox.height <= 720, 'caneta na janela').toBe(true)
  await gm.keyboard.press('Escape')

  await gm.getByRole('button', { name: 'Formas (S)' }).click({ button: 'right' })
  const shape = gm.getByRole('dialog', { name: 'Opções das formas' })
  await expect(shape).toBeVisible()
  await noScroll(shape, 'formas')
  await gm.keyboard.press('Escape')

  await gm.getByRole('button', { name: 'Selecionar (V)' }).click({ button: 'right' })
  const select = gm.getByRole('dialog', { name: 'Opções da seleção' })
  await expect(select).toBeVisible()
  await noScroll(select, 'seleção')
  const box = await select.boundingBox()
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 720, 'seleção na janela').toBe(true)
  await gm.keyboard.press('Escape')

  const layer = await openLayerMenu(gm, 'Tokens')
  await noScroll(layer, 'camada')
  await gm.keyboard.press('Escape')

  const member = await memberMenu(gm, 'Ana')
  await member.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await expect(member.getByRole('button', { name: 'Excluir jogador' })).toBeVisible() // estado mais alto
  await noScroll(member, 'membro')
  const memberBox = await member.boundingBox()
  expect(
    memberBox && memberBox.x >= 0 && memberBox.y >= 0 && memberBox.x + memberBox.width <= 1280 && memberBox.y + memberBox.height <= 720,
    'membro na janela',
  ).toBe(true)
  await gm.keyboard.press('Escape')

  const objMenu = await openObjectMenu(gm, token)
  await objMenu.getByRole('button', { name: /Mover para camada/ }).click()
  await noScroll(objMenu, 'objeto')
  await gm.keyboard.press('Escape')

  // menu do grupo do mestre com token: camadas abertas e permissões (estado mais alto)
  await pickSelect(gm)
  await dragPath(gm, [[token.x - 20, token.y - 20], [token.x + token.width + 20, token.y + token.height + 20]])
  expect(await selectionOf(gm)).toEqual({ whole: [token.id], parts: [] })
  await gm.mouse.click(token.x + token.width / 2, token.y + token.height / 2, { button: 'right' })
  const groupMenu = gm.getByRole('dialog', { name: 'Menu da seleção' })
  await expect(groupMenu).toBeVisible()
  await expect(groupMenu.getByRole('group', { name: 'Controle e permissões' })).toBeVisible()
  await groupMenu.getByRole('button', { name: /Mover para camada/ }).click()
  await expect(groupMenu.getByRole('group', { name: 'Camadas de destino' })).toBeVisible()
  await noScroll(groupMenu, 'grupo')
  const groupBox = await groupMenu.boundingBox()
  expect(
    groupBox && groupBox.x >= 0 && groupBox.y >= 0 && groupBox.x + groupBox.width <= 1280 && groupBox.y + groupBox.height <= 720,
    'grupo na janela',
  ).toBe(true)
})

// ── Limpar desenhos ─────────────────────────────────────────────────────────

/** Nenhum diálogo nativo (confirm/alert/prompt) pode aparecer: tudo passa pelo aviso do app. */
function trackNativeDialogs(...pages: Page[]): string[] {
  const seen: string[] = []
  for (const p of pages) {
    p.on('dialog', (d) => {
      seen.push(`${d.type()}: ${d.message()}`)
      void d.dismiss()
    })
  }
  return seen
}

/** Traço criado pela store (o desenho com o mouse já é coberto em outro teste). */
async function addStroke(page: Page, id: string, layerId: string): Promise<void> {
  await page.evaluate(
    ({ id, layerId }) =>
      (window as any).__mesa.getState().actions.submit({
        kind: 'create',
        object: {
          id, type: 'stroke', layerId, x: 100, y: 100, width: 50, height: 50, rotation: 0, zIndex: 1,
          segments: [[0, 0, 50, 50]], color: '#ffffff', strokeWidth: 4,
        },
      }),
    { id, layerId },
  )
  await page.waitForFunction(() => Object.keys((window as any).__mesa.getState().pending).length === 0)
}

const objectIds = async (page: Page) => (await objects(page)).map((o) => o.id).sort()
const confirmDialog = (page: Page) => page.getByRole('alertdialog')

/** Traço criado pela store a partir de pontos do mapa (com o zoom inicial, mapa = tela). */
async function addStrokeAt(page: Page, id: string, layerId: string, points: number[]): Promise<void> {
  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const object = {
    id, type: 'stroke', layerId, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0, zIndex: 1,
    segments: [points.map((v, i) => v - (i % 2 === 0 ? x : y))], color: '#ffffff', strokeWidth: 4,
  }
  await page.evaluate((o) => (window as any).__mesa.getState().actions.submit({ kind: 'create', object: o }), object)
  await page.waitForFunction(() => Object.keys((window as any).__mesa.getState().pending).length === 0)
}

/** Clica no Selecionar e afasta o mouse (o menu abre ao passar o mouse e fecha ao sair). */
async function pickSelect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Selecionar (V)' }).click()
  await page.mouse.move(900, 600)
  await expect(page.getByRole('dialog', { name: 'Opções da seleção' })).toHaveCount(0)
}

async function selectOptions(page: Page, opts: { shape?: 'Retângulo' | 'Laço'; allLayers?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Selecionar (V)' }).hover()
  const pop = page.getByRole('dialog', { name: 'Opções da seleção' })
  await expect(pop).toBeVisible()
  if (opts.shape) await pop.getByRole('button', { name: opts.shape }).click()
  if (opts.allLayers !== undefined) await pop.getByLabel('Todas as camadas').setChecked(opts.allLayers)
  await page.mouse.move(900, 600)
  await expect(pop).toHaveCount(0)
}

/** Arrasta pelos pontos (retângulo: início e fim; laço: o contorno). */
async function dragPath(page: Page, points: Array<[number, number]>, opts: { shift?: boolean } = {}): Promise<void> {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(points[0][0], points[0][1])
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
}

const selectionOf = (page: Page) =>
  page.evaluate(() => {
    const sel = (window as any).__mesa.getState().selection
    return sel ? { whole: [...sel.whole].sort(), parts: Object.keys(sel.parts).sort() } : null
  })

const settled = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as any).__mesa.getState()
    return Object.keys(s.pending).length === 0 && s.undoStack.length > 0
  })

test('jogador apaga os próprios desenhos na camada e em todas, pelo aviso; o resto fica', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')
  const dialogs = trackNativeDialogs(gm, ana, bia)

  await addStroke(ana, 'ana-d', 'drawings')
  await addStroke(ana, 'ana-t', 'tokens')
  await addStroke(bia, 'bia-d', 'drawings')
  await uploadToken(ana)
  const [img] = (await objects(ana)).filter((o) => o.type === 'image')
  await expect.poll(() => objectIds(gm)).toEqual(['ana-d', 'ana-t', 'bia-d', img.id].sort())

  // Esc cancela sem apagar
  await layerRow(ana, 'Desenhos').click({ button: 'right' })
  const menu = ana.getByRole('dialog', { name: 'Ações da camada' })
  await menu.getByRole('button', { name: 'Apagar meus desenhos nesta camada' }).click()
  await expect(confirmDialog(ana)).toContainText('1 desenho seu na camada Desenhos')
  await ana.keyboard.press('Escape')
  await expect(confirmDialog(ana)).toHaveCount(0)
  expect(await objectIds(ana)).toContain('ana-d')

  await layerRow(ana, 'Desenhos').click({ button: 'right' })
  await menu.getByRole('button', { name: 'Apagar meus desenhos nesta camada' }).click()
  await confirmDialog(ana).getByRole('button', { name: 'Apagar' }).click()
  await expect.poll(() => objectIds(gm)).toEqual(['ana-t', 'bia-d', img.id].sort())
  await expect.poll(() => objectIds(bia)).toEqual(['ana-t', 'bia-d', img.id].sort())

  await addStroke(ana, 'ana-d2', 'drawings')
  await layerRow(ana, 'Tokens').click({ button: 'right' })
  await menu.getByRole('button', { name: 'Apagar meus desenhos em todas as camadas' }).click()
  await expect(confirmDialog(ana)).toContainText('2 desenhos seus em 2 camadas')
  await ana.keyboard.press('Enter')
  await expect.poll(() => objectIds(gm)).toEqual(['bia-d', img.id].sort())
  await expect.poll(() => objectIds(ana)).toEqual(['bia-d', img.id].sort())
  expect(dialogs).toEqual([])
})

test('mestre apaga os desenhos de um jogador pelo menu do membro', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')
  const dialogs = trackNativeDialogs(gm, ana, bia)

  await addStroke(ana, 'ana-d', 'drawings')
  await addStroke(ana, 'ana-t', 'tokens')
  await addStroke(bia, 'bia-d', 'drawings')
  await expect.poll(() => objectIds(gm)).toEqual(['ana-d', 'ana-t', 'bia-d'])

  await selectLayer(gm, 'Desenhos')
  let menu = await memberMenu(gm, 'Ana')
  await menu.getByRole('button', { name: 'Apagar desenhos de Ana na camada atual' }).click()
  await expect(confirmDialog(gm)).toContainText('1 desenho de Ana na camada Desenhos')
  await confirmDialog(gm).getByRole('button', { name: 'Apagar' }).click()
  await expect.poll(() => objectIds(ana)).toEqual(['ana-t', 'bia-d'])

  menu = await memberMenu(gm, 'Ana')
  await menu.getByRole('button', { name: 'Apagar desenhos de Ana em todas as camadas' }).click()
  await confirmDialog(gm).getByRole('button', { name: 'Apagar' }).click()
  await expect.poll(() => objectIds(bia)).toEqual(['bia-d'])
  expect(await objectIds(gm)).toEqual(['bia-d'])
  expect(dialogs).toEqual([])
})

test('mestre limpa a camada (a camada fica) e remove camada pelo aviso do app', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const dialogs = trackNativeDialogs(gm, ana)

  await uploadToken(gm)
  await addStroke(ana, 'ana-t', 'tokens')
  await addStroke(ana, 'ana-d', 'drawings')
  await expect.poll(async () => (await objects(ana)).length).toBe(3)

  let menu = await openLayerMenu(gm, 'Tokens')
  await menu.getByRole('button', { name: 'Limpar camada (tudo, mantém a camada)' }).click()
  const modal = confirmDialog(gm)
  await expect(modal).toContainText('2 objetos da camada Tokens')
  const fits = await modal.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
  await modal.getByRole('button', { name: 'Limpar camada' }).click()
  await expect.poll(() => objectIds(ana)).toEqual(['ana-d'])
  await expect(layersPanel(ana).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])

  menu = await openLayerMenu(gm, 'Desenhos')
  await menu.getByRole('button', { name: 'Remover camada' }).click()
  await expect(confirmDialog(gm)).toContainText('Remover a camada Desenhos e 1 objeto')
  await confirmDialog(gm).getByRole('button', { name: 'Cancelar' }).click()
  await expect(layersPanel(ana).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])

  menu = await openLayerMenu(gm, 'Desenhos')
  await menu.getByRole('button', { name: 'Remover camada' }).click()
  await confirmDialog(gm).getByRole('button', { name: 'Remover' }).click()
  await expect(layersPanel(ana).locator('.layer-row')).toHaveText(['Tokens', 'Mapa'])
  expect(await objects(ana)).toEqual([])
  expect(dialogs).toEqual([])
})

test('olho e cadeado na linha da camada; a camada ativa do jogador muda quando fica travada ou oculta', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const active = () => ana.evaluate(() => (window as any).__mesa.getState().activeLayerId)

  await selectLayer(ana, 'Tokens')
  await expect(layerRow(ana, 'Tokens')).toHaveAttribute('aria-current', 'true')
  await layersPanel(gm).getByRole('button', { name: 'Travar Tokens para jogadores' }).click()
  await expect.poll(active).toBe('drawings')
  await expect(layerRow(ana, 'Desenhos')).toHaveAttribute('aria-current', 'true')
  await layerRow(ana, 'Tokens').click({ force: true }) // travada: não vira a ativa
  expect(await active()).toBe('drawings')

  await layersPanel(gm).getByRole('button', { name: 'Ocultar Desenhos para jogadores' }).click()
  await expect(layersPanel(ana).locator('.layer-row')).toHaveText(['Tokens', 'Mapa'])
  await expect.poll(active).toBe('map')
  await expect(layersPanel(gm).getByRole('button', { name: 'Mostrar Desenhos para jogadores' })).toHaveAttribute('aria-pressed', 'true')
})

// ── Turnos ──────────────────────────────────────────────────────────────────

const turnsWindow = (page: Page) => page.getByRole('region', { name: 'Turnos' })
const turnCards = (page: Page) => turnsWindow(page).locator('.turn-card')
const turnNames = (page: Page) => turnsWindow(page).locator('.turn-name')
const turnInits = (page: Page) => turnsWindow(page).locator('.turn-init')
const turnsState = (page: Page) => page.evaluate(() => (window as any).__mesa.getState().turns)
const ringCount = (page: Page): Promise<number> => page.evaluate(() => (window as any).__stage.find('.turn-ring').length)

test('turnos: mestre monta pelo token, duplica, rola e inicia; jogador acompanha a vez e o anel; encerrar mantendo participantes', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const dialogs = trackNativeDialogs(gm, player)

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  // jogador não tem o botão da barra; ninguém vê a janela ainda
  await expect(player.getByRole('button', { name: 'Turnos', exact: true })).toHaveCount(0)
  await expect(turnsWindow(player)).toHaveCount(0)

  // botão direito no token: adicionar abre a janela para todos
  const menu = await openObjectMenu(gm, token)
  await menu.getByRole('button', { name: 'Adicionar à ordem de turnos' }).click()
  await expect(turnsWindow(player)).toBeVisible()
  await expect(turnNames(player)).toHaveText(['Token'])
  await expect(turnInits(player)).toHaveText(['?'])

  // duplicar (o botão aparece com o mouse sobre o card) e um participante livre
  const first = turnCards(gm).first()
  await first.hover()
  await first.getByRole('button', { name: 'Duplicar Token', exact: true }).click()
  await turnsWindow(gm).getByLabel('Nome do participante').fill('Goblin')
  await turnsWindow(gm).getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(turnNames(player)).toHaveText(['Token', 'Token 2', 'Goblin'])
  // a janela cabe em 1280x720 sem rolagem horizontal (janela e lista)
  for (const page of [gm, player]) {
    expect(await turnsWindow(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await turnsWindow(page).locator('.turns-list').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }

  // iniciativa digitada no card: fora do limite é recusada; -99 deixa o Goblin por último depois da rolagem
  await turnCards(gm).nth(2).locator('.turn-init').click()
  const initField = turnsWindow(gm).getByLabel('Iniciativa de Goblin')
  await initField.fill('1000')
  await expect(initField).toHaveAttribute('aria-invalid', 'true')
  await initField.fill('-99')
  await initField.press('Enter')
  await expect(turnInits(player)).toHaveText(['?', '?', '-99'])

  // rolar só quem está sem valor
  await turnsWindow(gm).getByRole('button', { name: 'Rolar iniciativa', exact: true }).click()
  await expect.poll(async () => (await turnsState(player)).entries.every((e: any) => e.initiative !== null)).toBe(true)
  await expect(turnNames(player).last()).toHaveText('Goblin')
  const rolled: number[] = (await turnsState(player)).entries.slice(0, 2).map((e: any) => e.initiative)
  for (const v of rolled) {
    expect(v).toBeGreaterThanOrEqual(1)
    expect(v).toBeLessThanOrEqual(20)
  }
  expect(rolled[0]).toBeGreaterThanOrEqual(rolled[1])
  // a rolagem é aleatória: a ordem de Token e Token 2 vale a que a mesa mostra agora
  const order = await turnNames(player).allTextContents()
  expect([...order].sort()).toEqual(['Goblin', 'Token', 'Token 2'])
  expect(order[2]).toBe('Goblin')
  await expect(turnNames(gm)).toHaveText(order)

  // iniciar: o jogador vê a rodada, o card da vez e o anel no token
  await turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true }).click()
  await expect(turnsWindow(player)).toContainText('Rodada 1')
  await expect(turnCards(player).nth(0)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(1)

  // "Próximo" avança nos dois; o Goblin não tem token (sem anel); a virada soma a rodada
  const next = turnsWindow(gm).getByRole('button', { name: 'Próximo turno', exact: true })
  await next.click()
  await expect(turnCards(player).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(turnCards(gm).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(1)
  await next.click()
  await expect(turnCards(player).nth(2)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(0)
  await next.click()
  await expect(turnsWindow(player)).toContainText('Rodada 2')
  await expect(turnCards(player).nth(0)).toHaveAttribute('aria-current', 'true')

  // jogador: sem controles, sem alças; a miniatura centraliza a própria câmera
  for (const name of ['Adicionar', 'Próximo turno', 'Turno anterior', 'Encerrar', 'Fechar para todos']) {
    await expect(turnsWindow(player).getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(turnsWindow(player).locator('.turn-handle')).toHaveCount(0)
  await turnCards(player).first().hover()
  await expect(turnsWindow(player).getByRole('button', { name: /^(Duplicar|Remover) / })).toHaveCount(0)
  await turnCards(player).first().getByRole('button', { name: `Centralizar em ${order[0]}`, exact: true }).click()
  await expect
    .poll(() => player.evaluate(() => Math.round((window as any).__mesa.getState().viewport.x)))
    .toBe(Math.round(640 - (token.x + token.width / 2)))

  // sem rolagem horizontal na janela
  expect(await turnsWindow(player).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // encerrar mantendo os participantes, pelo aviso do app
  await turnsWindow(gm).getByRole('button', { name: 'Encerrar', exact: true }).click()
  const dialog = confirmDialog(gm)
  await expect(dialog.getByRole('button')).toHaveText(['Cancelar', 'Encerrar e limpar', 'Encerrar e manter participantes'])
  await dialog.getByRole('button', { name: 'Encerrar e manter participantes' }).click()
  await expect(turnInits(player)).toHaveText(['?', '?', '?'])
  await expect(turnNames(player)).toHaveText(order)
  await expect(turnsWindow(player)).not.toContainText('Rodada')
  await expect(turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true })).toBeVisible()

  // reordenar arrastando a alça do primeiro card até o último (turnMove), nos dois clientes
  await turnCards(gm).nth(0).locator('.turn-handle').dragTo(turnCards(gm).nth(2))
  const moved = [order[1], order[2], order[0]]
  await expect(turnNames(gm)).toHaveText(moved)
  await expect(turnNames(player)).toHaveText(moved)
  expect(dialogs).toEqual([])
})

test('turnos: cada um minimiza a própria janela (lembrada ao recarregar); o mestre fecha para todos', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  const toolbarButton = gm.getByRole('button', { name: 'Turnos', exact: true })
  await toolbarButton.click()
  await expect(toolbarButton).toHaveAttribute('aria-pressed', 'true')
  await expect(turnsWindow(player)).toBeVisible()
  await expect(turnsWindow(player)).toContainText('Nenhum participante ainda.')
  await expect(turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true })).toBeDisabled()

  await turnsWindow(gm).getByLabel('Nome do participante').fill('Ana')
  await turnsWindow(gm).getByLabel('Nome do participante').press('Enter')
  await turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true }).click()
  await expect(turnsWindow(player)).toContainText('Rodada 1')

  // minimizar é só da minha janela, e é lembrado ao recarregar
  await turnsWindow(player).getByRole('button', { name: 'Minimizar' }).click()
  await expect(turnsWindow(player)).toHaveText('Rodada 1 · Vez de: Ana')
  await expect(turnCards(gm)).toHaveCount(1)
  await player.reload()
  await waitOpen(player)
  await expect(turnsWindow(player)).toHaveText('Rodada 1 · Vez de: Ana')
  await turnsWindow(player).getByRole('button', { name: 'Rodada 1 · Vez de: Ana' }).click()
  await expect(turnCards(player)).toHaveCount(1)

  // fechar é do mestre e vale para todos
  await turnsWindow(gm).getByRole('button', { name: 'Fechar para todos' }).click()
  await expect(turnsWindow(player)).toHaveCount(0)
  await expect(turnsWindow(gm)).toHaveCount(0)
  await expect(toolbarButton).toHaveAttribute('aria-pressed', 'false')
})

// ── Seleção em área ─────────────────────────────────────────────────────────

test('seleção em retângulo corta o traço e move junto com o token; o outro vê; Ctrl+Z desfaz tudo', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await uploadToken(ana) // camada Tokens, centro da tela: x 605..675, y 325..395
  await addStrokeAt(ana, 'risco', 'tokens', [450, 300, 850, 300])
  await expect.poll(async () => (await objects(gm)).length).toBe(2)
  const [token] = (await objects(ana)).filter((o) => o.type === 'image')

  await pickSelect(ana)
  await dragPath(ana, [[550, 250], [720, 420]])
  expect(await selectionOf(ana)).toEqual({ whole: [token.id], parts: ['risco'] })

  await dragPath(ana, [[640, 360], [640, 510]]) // arrasta pelo token: move o grupo 150 px para baixo
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(2)
  const strokes = (await objects(gm)).filter((o) => o.type === 'stroke')
  const moved = strokes.find((o) => Math.round(o.y) === 450)!
  expect([Math.round(moved.x), Math.round(moved.width)]).toEqual([550, 170])
  expect(strokes.find((o) => Math.round(o.y) === 300)!.segments).toHaveLength(2)
  await expect.poll(async () => Math.round((await objects(gm)).find((o) => o.id === token.id)!.y)).toBe(Math.round(token.y + 150))

  await settled(ana)
  await ana.keyboard.press('Control+z')
  await expect.poll(() => objectIds(gm)).toEqual([token.id, 'risco'].sort())
  expect(Math.round((await objects(gm)).find((o) => o.id === token.id)!.y)).toBe(Math.round(token.y))
})

test('seleção em laço apaga só a parte de dentro do traço (Delete)', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await selectLayer(gm, 'Desenhos')
  await addStrokeAt(gm, 'linha', 'drawings', [300, 300, 700, 300])
  await expect.poll(async () => (await objects(ana)).length).toBe(1)
  await pickSelect(gm)
  await selectOptions(gm, { shape: 'Laço' })
  await dragPath(gm, [[450, 250], [550, 250], [550, 350], [450, 350], [452, 252]])
  expect(await selectionOf(gm)).toEqual({ whole: [], parts: ['linha'] })

  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await objects(ana)).map((o) => [o.id === 'linha', o.segments?.length])).toEqual([[false, 2]])
})

test('seleção em todas as camadas: o mestre leva itens de duas camadas para o Mapa pelo menu do grupo', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await addStrokeAt(gm, 'a', 'drawings', [300, 300, 400, 300])
  await addStrokeAt(gm, 'b', 'tokens', [300, 350, 400, 350])
  await pickSelect(gm)
  await selectOptions(gm, { allLayers: true })
  await dragPath(gm, [[250, 250], [450, 400]])
  expect(await selectionOf(gm)).toEqual({ whole: ['a', 'b'], parts: [] })

  await gm.mouse.click(350, 325, { button: 'right' })
  const menu = gm.getByRole('dialog', { name: 'Menu da seleção' })
  await expect(menu).toContainText('2 itens selecionados')
  await menu.getByRole('button', { name: 'Mover para camada' }).click()
  await menu.getByRole('group', { name: 'Camadas de destino' }).getByRole('button', { name: 'Mapa', exact: true }).click()
  await expect.poll(async () => (await objects(ana)).map((o) => o.layerId)).toEqual(['map', 'map'])
})

test('seleção: jogador não pega o token do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(ana)).length).toBe(1)
  const [token] = await objects(gm)
  await pickSelect(ana)
  await dragPath(ana, [[550, 250], [720, 420]])
  expect(await selectionOf(ana)).toBeNull()
  await dragPath(ana, [[640, 360], [640, 500]])
  await ana.waitForTimeout(300)
  expect(Math.round((await objects(gm))[0].y)).toBe(Math.round(token.y))
  // nada foi enviado nem selecionado (o teste não passa por não ter feito nada)
  expect(
    await ana.evaluate(() => {
      const s = (window as any).__mesa.getState()
      return { pending: Object.keys(s.pending).length, undo: s.undoStack.length, selection: s.selection }
    }),
  ).toEqual({ pending: 0, undo: 0, selection: null })
})

test('seleção: Shift + arrastar soma; Shift + clique pinga sem mexer na seleção; Esc desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await addStrokeAt(ana, 'a', 'tokens', [300, 300, 400, 300])
  await addStrokeAt(ana, 'b', 'tokens', [300, 500, 400, 500])
  await pickSelect(ana)
  await dragPath(ana, [[250, 250], [450, 350]])
  expect(await selectionOf(ana)).toEqual({ whole: ['a'], parts: [] })
  await dragPath(ana, [[250, 450], [450, 550]], { shift: true })
  expect(await selectionOf(ana)).toEqual({ whole: ['a', 'b'], parts: [] })

  await ana.keyboard.down('Shift')
  await ana.mouse.click(600, 620)
  await ana.keyboard.up('Shift')
  await expect.poll(() => gm.evaluate(() => (window as any).__mesa.getState().pings.length)).toBe(1)
  expect(await selectionOf(ana)).toEqual({ whole: ['a', 'b'], parts: [] })

  // Esc no meio do arrasto do grupo: cancela (nada é enviado) e desfaz a seleção
  await ana.mouse.move(350, 300)
  await ana.mouse.down()
  await ana.mouse.move(350, 400, { steps: 5 })
  await ana.keyboard.press('Escape')
  await ana.mouse.up()
  expect(await selectionOf(ana)).toBeNull()
  await ana.waitForTimeout(300)
  expect(await ana.evaluate(() => Object.keys((window as any).__mesa.getState().pending).length)).toBe(0)
  expect((await objects(gm)).map((o) => Math.round(o.y)).sort()).toEqual([300, 500])
})

test('seleção: quem assiste vê o contorno do grupo sendo arrastado, com o nome de quem arrasta', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const groupDrags = () => ana.evaluate(() => Object.keys((window as any).__mesa.getState().groupDrags).length)

  await addStrokeAt(gm, 'a', 'tokens', [300, 300, 400, 300])
  await addStrokeAt(gm, 'b', 'tokens', [300, 350, 400, 350])
  await pickSelect(gm)
  await dragPath(gm, [[250, 250], [450, 400]])
  await gm.mouse.move(350, 325)
  await gm.mouse.down()
  await gm.mouse.move(350, 425, { steps: 10 })
  await expect.poll(groupDrags).toBe(1)
  await gm.mouse.up()
  await expect.poll(groupDrags).toBe(0)
  await expect.poll(async () => (await objects(ana)).map((o) => Math.round(o.y)).sort()).toEqual([400, 450])
})

test('borracha em todas as camadas corta traços de duas camadas numa passada', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await addStrokeAt(ana, 'a', 'drawings', [300, 300, 600, 300])
  await addStrokeAt(ana, 'b', 'tokens', [300, 330, 600, 330])
  await expect.poll(async () => (await objects(gm)).length).toBe(2)

  await ana.keyboard.press('e')
  await ana.getByRole('button', { name: 'Borracha (E)' }).hover()
  const pop = ana.getByRole('dialog', { name: 'Opções da caneta' })
  await pop.getByLabel('Todas as camadas').check()
  await ana.mouse.move(900, 600)
  await expect(pop).toHaveCount(0)

  await ana.mouse.move(450, 250)
  await ana.mouse.down()
  await ana.mouse.move(450, 380, { steps: 10 })
  await ana.mouse.up()
  await expect.poll(async () => (await objects(gm)).map((o) => `${o.id}:${o.segments?.length}`).sort()).toEqual(['a:2', 'b:2'])
})

// ---------------------------------------------------------------- vínculo entre sessões

test('jogador volta com navegador limpo pelo "Já jogou aqui?": mesmo membro e controle do próprio token', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  const anaId = await selfId(player)
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.context().close()
  await expect
    .poll(() => gm.evaluate((id) => (window as any).__mesa.getState().members[id]?.online, anaId))
    .toBe(false)

  const back = await (await browser.newContext()).newPage()
  await back.goto(playerPath(t))
  await expect(back.getByText('Já jogou aqui? Clique no seu nome')).toBeVisible()
  await back.getByRole('button', { name: 'Ana', exact: true }).click()
  await waitOpen(back)
  expect(await selfId(back)).toBe(anaId)
  const [token] = await objects(back)
  await dragObject(back, token, 100, 50)
  await expect.poll(async () => Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x + 100))
})

test('mestre com navegador limpo pelo link de mestre recupera a autoria', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const gmId = await selfId(gm)
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await gm.context().close()
  const again = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  expect(await selfId(again)).toBe(gmId)
  const owner = await again.evaluate(() => (Object.values((window as any).__mesa.getState().objects)[0] as any).ownerId)
  expect(owner).toBe(gmId)
})

// ---------------------------------------------------------------- página inicial local

const tableCard = (page: Page, name: string) =>
  page.locator('.table-card').filter({ has: page.getByRole('heading', { name, exact: true }) })

test('lista local: criar duas mesas pela página, mais recente primeiro; renomear persiste', async ({ page }) => {
  const stamp = Date.now()
  const [a, b, c] = [`Lista A ${stamp}`, `Lista B ${stamp}`, `Lista C ${stamp}`]
  await page.goto('/')
  for (const name of [a, b]) {
    await page.getByLabel('Nome da mesa').fill(name)
    await page.getByRole('button', { name: 'Criar mesa' }).click()
    await expect(tableCard(page, name)).toBeVisible()
  }
  const names = await page.locator('.table-card h3').allTextContents()
  expect(names.indexOf(b)).toBeLessThan(names.indexOf(a))

  const card = tableCard(page, a)
  await card.getByRole('button', { name: 'Renomear' }).click()
  await card.getByLabel('Novo nome').fill(c)
  await card.getByRole('button', { name: 'Salvar' }).click()
  await expect(tableCard(page, c)).toBeVisible()
  await page.reload()
  await expect(tableCard(page, c)).toBeVisible()
  await expect(tableCard(page, a)).toHaveCount(0)
})

test('apagar pelo aviso do app: some da lista; o jogador conectado vê "A mesa foi apagada" e volta ao início', async ({ browser, page }) => {
  const name = `Apagar ${Date.now()}`
  const res = await page.request.post('/api/tables', { data: { name } })
  const t = await res.json()
  const player = await open(browser, playerPath(t), 'Ana')
  await page.goto('/')
  const card = tableCard(page, name)
  await card.getByRole('button', { name: 'Apagar' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(`Apagar a mesa ${name}? Desenhos, tokens, chat e turnos serão perdidos.`)
  await dialog.getByRole('button', { name: 'Apagar' }).click()
  await expect(card).toHaveCount(0)
  await expect(player.getByText('A mesa foi apagada')).toBeVisible()
  await expect(player).toHaveURL(/\/$/, { timeout: 10_000 })
})

test('links das mesas usam o túnel informado; sem túnel, aviso e links locais', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const name = `Túnel ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const tunnel = 'https://e2e-teste.trycloudflare.com'
  const key = `#j=${t.playerKey}`
  expect((await page.request.post('/api/registry/tunnel', { data: { url: tunnel } })).status()).toBe(204)
  try {
    await page.goto('/')
    await expect(page.getByText(tunnel)).toBeVisible()
    const card = tableCard(page, name)
    await card.getByRole('button', { name: 'Copiar link de jogador' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${tunnel}/t/${t.tableId}${key}`)
    await card.getByRole('button', { name: 'Copiar link de mestre' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${tunnel}/t/${t.tableId}#gm=${t.gmSecret}`)
    await expect(card.getByRole('link', { name: 'Abrir como mestre' })).toHaveAttribute('href', `/t/${t.tableId}#gm=${t.gmSecret}`)
  } finally {
    await page.request.post('/api/registry/tunnel', { data: { url: null } })
  }
  await page.reload()
  await expect(page.getByText('Túnel indisponível, só local')).toBeVisible()
  await tableCard(page, name).getByRole('button', { name: 'Copiar link de jogador' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/t/${t.tableId}${key}`)
})

test('página inicial sem rolagem horizontal em 1280x720 e em janela estreita', async ({ page }) => {
  await page.request.post('/api/tables', { data: { name: 'Nome comprido de mesa '.repeat(3).trim().slice(0, 60) } })
  const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  await page.goto('/')
  await expect(page.locator('.table-card').first()).toBeVisible()
  expect(await noHorizontalScroll()).toBe(true)
  await page.setViewportSize({ width: 360, height: 640 })
  expect(await noHorizontalScroll()).toBe(true)
})

test('pedido pelo túnel (cabeçalhos da Cloudflare) não vê a lista nem cria mesa; o link da mesa funciona', async ({ browser, page }) => {
  const edge = { 'cf-ray': '8f00000000000000-GRU', 'cf-connecting-ip': '200.100.50.25' }
  expect((await page.request.get('/api/registry/tables', { headers: edge })).status()).toBe(404)
  expect((await page.request.post('/api/tables', { headers: edge, data: { name: 'x' } })).status()).toBe(404)
  const t = await newTable(page)
  const remote = await (await browser.newContext({ extraHTTPHeaders: edge })).newPage()
  await remote.goto('/')
  await expect(remote.getByText('Peça o link da mesa ao mestre')).toBeVisible()
  await expect(remote.getByRole('button', { name: 'Criar mesa' })).toHaveCount(0)
  await remote.goto(playerPath(t))
  await remote.getByLabel('Seu apelido').fill('Remota')
  await remote.getByRole('button', { name: 'Entrar' }).click()
  await waitOpen(remote)
})

// ---------------------------------------------------------------- excluir jogador

async function removeFromMenu(gm: Page, name: string, choice: 'Excluir e manter as coisas' | 'Excluir e apagar as coisas dele') {
  const menu = await memberMenu(gm, name)
  await menu.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await menu.getByRole('button', { name: 'Excluir jogador' }).click()
  const dialog = confirmDialog(gm)
  await expect(dialog).toContainText(`Excluir ${name} da mesa?`)
  await dialog.getByRole('button', { name: choice }).click()
}

test('excluir jogador online mantendo as coisas: ele é desconectado; o token fica só do mestre', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await removeFromMenu(gm, 'Ana', 'Excluir e manter as coisas')
  await expect(player.getByText('Você foi removido da mesa')).toBeVisible()
  await expect(memberRow(gm, 'Ana')).toHaveCount(0)
  await expect.poll(async () => (await objects(gm))[0].control).toEqual({ mode: 'gm', clientIds: [] })

  // quem volta com o mesmo apelido é pessoa nova e não move o token; o mestre move
  const back = await open(browser, playerPath(t), 'Ana')
  const [token] = await objects(back)
  expect(token.ownerId).not.toBe(await selfId(back))
  await dragObject(back, token, 100, 50)
  await back.waitForTimeout(500)
  expect(Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x))
  await dragObject(gm, token, 100, 50)
  await expect.poll(async () => Math.round((await objects(back))[0].x)).toBe(Math.round(token.x + 100))
})

test('excluir jogador apagando as coisas: o token dele some para todos', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  const observer = await open(browser, playerPath(t), 'Bia')
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await expect.poll(async () => (await objects(observer)).length).toBe(1)
  await removeFromMenu(gm, 'Ana', 'Excluir e apagar as coisas dele')
  await expect(player.getByText('Você foi removido da mesa')).toBeVisible()
  await expect.poll(async () => (await objects(gm)).length).toBe(0)
  await expect.poll(async () => (await objects(observer)).length).toBe(0)
})

test('link de jogador sem a chave: "Este link expirou. Peça o link novo ao mestre" antes de pedir o apelido', async ({ browser, page }) => {
  const t = await newTable(page)
  const stray = await (await browser.newContext()).newPage()
  await stray.goto(`/t/${t.tableId}`)
  await expect(stray.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()
  await expect(stray.getByLabel('Seu apelido')).toHaveCount(0)
})

// ---------------------------------------------------------------- gerar novos links

async function rotateFromCard(page: Page, name: string, label: 'Gerar novo link de jogador' | 'Gerar novo link de mestre') {
  await page.goto('/')
  await tableCard(page, name).getByRole('button', { name: label }).click()
  await expect(confirmDialog(page)).toContainText('Quem já está na mesa continua conectado.')
  await confirmDialog(page).getByRole('button', { name: 'Gerar novo link' }).click()
  await expect(confirmDialog(page)).toHaveCount(0)
}

const registryEntry = async (page: Page, id: string) =>
  ((await (await page.request.get('/api/registry/tables')).json()).tables as any[]).find((t) => t.id === id)

test('novo link de jogador: o antigo expira com a mensagem, o novo funciona, quem está conectado continua', async ({ browser, page }) => {
  const name = `Link jogador ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const player = await open(browser, playerPath(t), 'Ana')
  await rotateFromCard(page, name, 'Gerar novo link de jogador')
  await expect.poll(async () => (await registryEntry(page, t.tableId)).playerKey).not.toBe(t.playerKey)
  const fresh = await registryEntry(page, t.tableId)

  const stale = await (await browser.newContext()).newPage()
  await stale.goto(playerPath(t))
  await expect(stale.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()
  await open(browser, playerPath({ tableId: t.tableId, playerKey: fresh.playerKey }), 'Bia')
  expect(await player.evaluate(() => (window as any).__mesa.getState().status)).toBe('open')
})

test('novo link de mestre: o antigo expira, "Abrir como mestre" usa o novo e entra como mestre', async ({ browser, page }) => {
  const name = `Link mestre ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  await rotateFromCard(page, name, 'Gerar novo link de mestre')
  await expect.poll(async () => (await registryEntry(page, t.tableId)).gmSecret).not.toBe(t.gmSecret)
  const { gmSecret } = await registryEntry(page, t.tableId)
  // o segredo guardado neste navegador (o do mestre no PC) passa a ser o novo
  expect(await page.evaluate((id) => localStorage.getItem(`mesa:gm:${id}`), t.tableId)).toBe(gmSecret)
  await page.reload()
  await expect(tableCard(page, name).getByRole('link', { name: 'Abrir como mestre' })).toHaveAttribute('href', `/t/${t.tableId}#gm=${gmSecret}`)

  const stale = await (await browser.newContext()).newPage()
  await stale.goto(`/t/${t.tableId}?debug=1#gm=${t.gmSecret}`)
  await stale.getByLabel('Seu apelido').fill('Mestre')
  await stale.getByRole('button', { name: 'Entrar' }).click()
  await expect(stale.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()

  const again = await open(browser, `/t/${t.tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  expect(await again.evaluate(() => (window as any).__mesa.getState().self.role)).toBe('gm')
  expect(await gm.evaluate(() => (window as any).__mesa.getState().status)).toBe('open')
})

test('card da lista: enquanto gera um link, os botões de gerar, renomear e apagar ficam desativados', async ({ page }) => {
  const name = `Ocupado ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  let rotations = 0
  await page.route(`**/api/registry/tables/${t.tableId}/player-link`, async (route) => {
    rotations++
    await held
    await route.continue()
  })
  await page.goto('/')
  const card = tableCard(page, name)
  const buttons = ['Gerar novo link de jogador', 'Gerar novo link de mestre', 'Renomear', 'Apagar'].map((label) =>
    card.getByRole('button', { name: label }),
  )
  await buttons[0].click()
  await confirmDialog(page).getByRole('button', { name: 'Gerar novo link' }).click()
  await expect.poll(() => rotations).toBe(1)
  for (const b of buttons) await expect(b).toBeDisabled()
  release()
  for (const b of buttons) await expect(b).toBeEnabled()
  expect(rotations).toBe(1)
})

interface PenInput {
  x: number
  y: number
  /** 0 ponta, 2 botão lateral, 5 borracha; -1 = nenhum botão mudou (movimento). */
  button?: number
  /** 0 pairando, 1 ponta, 2 botão lateral, 32 borracha. */
  buttons?: number
  /** Pontos intermediários que o navegador juntaria no movimento (getCoalescedEvents). */
  coalesced?: [number, number][]
}

/** Mesa digitalizadora simulada: PointerEvents com pointerType 'pen' direto no canvas. */
async function pen(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', input: PenInput): Promise<void> {
  await page.evaluate(
    ({ type, input }) => {
      const content = document.querySelector('.konvajs-content')!
      const base = { pointerId: 7, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, composed: true }
      const at = (x: number, y: number) => ({ clientX: x, clientY: y, screenX: x, screenY: y })
      const buttons = input.buttons ?? 0
      const coalescedEvents = (input.coalesced ?? []).map(
        ([x, y]) => new PointerEvent('pointermove', { ...base, ...at(x, y), buttons, pressure: buttons ? 0.5 : 0 }),
      )
      content.dispatchEvent(
        new PointerEvent(type, {
          ...base,
          ...at(input.x, input.y),
          button: input.button ?? -1,
          buttons,
          pressure: buttons ? 0.5 : 0,
          coalescedEvents,
        }),
      )
    },
    { type, input },
  )
}

/** Traço de caneta reto de (x1, y1) a (x2, y2), em passos, com um botão segurado. */
async function penStroke(page: Page, from: [number, number], to: [number, number], button = 0, buttons = 1): Promise<void> {
  await pen(page, 'pointermove', { x: from[0], y: from[1] })
  await pen(page, 'pointerdown', { x: from[0], y: from[1], button, buttons })
  for (let i = 1; i <= 10; i++) {
    await pen(page, 'pointermove', { x: from[0] + ((to[0] - from[0]) * i) / 10, y: from[1] + ((to[1] - from[1]) * i) / 10, buttons })
  }
  await pen(page, 'pointerup', { x: to[0], y: to[1], button, buttons: 0 })
}

test('caneta: o traço aparece para o outro com os pontos juntados pelo navegador; pairar não desenha', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await pickPencil(player)
  // pairando sobre a mesa: nada é desenhado
  await pen(player, 'pointermove', { x: 200, y: 200 })
  await pen(player, 'pointermove', { x: 260, y: 240 })
  await pen(player, 'pointerdown', { x: 300, y: 300, button: 0, buttons: 1 })
  // um único evento com três pontos juntados: o do meio desce até y = 380
  await pen(player, 'pointermove', { x: 400, y: 300, buttons: 1, coalesced: [[340, 340], [350, 380], [400, 300]] })
  await pen(player, 'pointermove', { x: 450, y: 300, buttons: 1 })
  await pen(player, 'pointerup', { x: 450, y: 300, button: 0, buttons: 0 })
  await pen(player, 'pointermove', { x: 600, y: 500 })

  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)
  const stroke = (await objects(gm)).find((o) => o.type === 'stroke')!
  expect(Math.round(stroke.x)).toBe(300)
  expect(Math.round(stroke.y)).toBe(300)
  expect(Math.round(stroke.x + stroke.width)).toBe(450)
  expect(Math.round(stroke.y + stroke.height)).toBe(380)
})

test('caneta: a ponta de borracha apaga com o Selecionar escolhido, que continua escolhido', async ({ browser, page }) => {
  const { tableId, gmSecret, playerKey } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await pickPencil(player)
  await penStroke(player, [300, 300], [600, 300])
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)

  await player.keyboard.press('v')
  await expect(player.getByRole('button', { name: 'Selecionar (V)' })).toHaveAttribute('aria-pressed', 'true')
  await penStroke(player, [450, 250], [450, 350], 5, 32)

  await expect.poll(async () => (await objects(gm)).find((o) => o.type === 'stroke')?.segments?.length).toBe(2)
  expect(await player.evaluate(() => (window as any).__mesa.getState().tool)).toBe('select')
  expect(await player.evaluate(() => (window as any).__mesa.getState().selectedId)).toBeNull()
})

test('caneta: o botão lateral dobra a régua, sem abrir menu', async ({ browser, page }) => {
  const { tableId, playerKey } = await newTable(page)
  const ana = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1#j=${playerKey}`, 'Bia')
  const line = () => bia.evaluate(() => (window as any).__stage.find('.ruler-line').map((n: any) => n.points()))

  await ana.getByRole('button', { name: 'Régua (R)' }).click()
  await pen(ana, 'pointerdown', { x: 400, y: 300, button: 0, buttons: 1 })
  await pen(ana, 'pointerup', { x: 400, y: 300, button: 0, buttons: 0 })
  await pen(ana, 'pointermove', { x: 700, y: 300 })
  await pen(ana, 'pointerdown', { x: 700, y: 300, button: 2, buttons: 2 })
  await pen(ana, 'pointerup', { x: 700, y: 300, button: 2, buttons: 0 })
  await pen(ana, 'pointermove', { x: 740, y: 450 })
  await expect.poll(line).toEqual([[400, 300, 700, 300, 740, 450]])
  await expect(ana.getByRole('dialog')).toHaveCount(0)
})
