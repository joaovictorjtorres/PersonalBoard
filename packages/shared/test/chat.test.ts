import { describe, expect, it } from 'vitest'
import { ChatChannelSchema, ChatImageSideSchema, ChatTextSchema } from '../src'

describe('chat', () => {
  it('canal: mesa ou conversa privada', () => {
    expect(ChatChannelSchema.safeParse('table').success).toBe(true)
    expect(ChatChannelSchema.safeParse({ dm: 'abc' }).success).toBe(true)
    expect(ChatChannelSchema.safeParse({ dm: '' }).success).toBe(false)
    expect(ChatChannelSchema.safeParse({ dm: 'abc', extra: 1 }).success).toBe(false)
    expect(ChatChannelSchema.safeParse('gm').success).toBe(false)
  })

  it('texto aparado, de 1 a 500', () => {
    expect(ChatTextSchema.parse('  oi  ')).toBe('oi')
    expect(ChatTextSchema.safeParse('   ').success).toBe(false)
    expect(ChatTextSchema.safeParse('x'.repeat(500)).success).toBe(true)
    expect(ChatTextSchema.safeParse('x'.repeat(501)).success).toBe(false)
  })

  it('lado da imagem: inteiro de 1 a 16384', () => {
    expect(ChatImageSideSchema.safeParse(1).success).toBe(true)
    expect(ChatImageSideSchema.safeParse(16_384).success).toBe(true)
    expect(ChatImageSideSchema.safeParse(0).success).toBe(false)
    expect(ChatImageSideSchema.safeParse(1.5).success).toBe(false)
  })
})
