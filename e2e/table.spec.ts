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

test('passar o mouse nas ferramentas abre o menu; atravessar o vão não fecha; um aberto por vez', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
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

  await gm.mouse.move(800, 600)
  await expect(shape).toHaveCount(0)

  await gm.getByRole('button', { name: 'Grade', exact: true }).hover()
  await expect(gm.getByRole('dialog', { name: 'Grade' })).toBeVisible()
  await expect(player.getByRole('button', { name: 'Grade', exact: true })).toHaveCount(0)
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
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')

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
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const labels = () => player.evaluate(() => (window as any).__stage.find('.ruler-label').map((n: any) => n.text()))

  await gm.getByRole('button', { name: 'Régua (R)' }).click()
  await gm.mouse.click(400, 300) // a distância conta do centro do quadrado (385, 315)…
  await gm.mouse.move(700, 300, { steps: 10 }) // …até o centro de (735, 315)
  await expect.poll(labels).toEqual(['Mestre · 5,0 m'])

  await gm.keyboard.press('Escape')
  await expect.poll(labels).toEqual([])
})

test('régua com dobra: botão direito dobra, o outro vê a linha quebrada com a soma', async ({ browser, page }) => {
  const { tableId } = await newTable(page)
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')
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
  const { tableId, gmSecret } = await newTable(page)

  // modal de apelido, em um contexto novo
  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto(`/t/${tableId}?debug=1`)
  await expect(fresh.getByLabel('Seu apelido')).toBeVisible()
  const noScroll = (loc: import('@playwright/test').Locator, name: string) =>
    loc.evaluate((el) => ({ w: el.scrollWidth <= el.clientWidth, h: el.scrollHeight <= el.clientHeight }))
      .then((r) => expect(r, name).toEqual({ w: true, h: true }))
  await noScroll(fresh.locator('.modal'), 'nickname')

  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
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
  await gm.keyboard.press('Escape')

  await gm.getByRole('button', { name: 'Formas (S)' }).click({ button: 'right' })
  const shape = gm.getByRole('dialog', { name: 'Opções das formas' })
  await expect(shape).toBeVisible()
  await noScroll(shape, 'formas')
  await gm.keyboard.press('Escape')

  const layer = await openLayerMenu(gm, 'Tokens')
  await noScroll(layer, 'camada')
  await gm.keyboard.press('Escape')

  const member = await memberMenu(gm, 'Ana')
  await member.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await noScroll(member, 'membro')
  await gm.keyboard.press('Escape')

  const objMenu = await openObjectMenu(gm, token)
  await objMenu.getByRole('button', { name: /Mover para camada/ }).click()
  await noScroll(objMenu, 'objeto')
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

test('jogador apaga os próprios desenhos na camada e em todas, pelo aviso; o resto fica', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')
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
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')
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
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
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
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
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
