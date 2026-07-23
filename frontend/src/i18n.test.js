import { afterEach, describe, expect, it } from 'vitest'
import { installDomTranslator, setLanguage, translateText } from './i18n'

afterEach(() => setLanguage('th'))

describe('bilingual UI dictionary', () => {
  it('translates LiveShare and guide content to English', () => {
    setLanguage('en')
    expect(translateText('ชั่วโมงเล่น')).toBe('Playing hours')
    expect(translateText('ระบบคำนวณแยกทีละชั่วโมง ไม่ใช่เอายอดรวมทั้งวันมาหารรวมกัน')).toBe(
      'Costs are calculated separately for each hour, not by splitting the whole-day total'
    )
  })

  it('translates support and backoffice controls to English', () => {
    setLanguage('en')
    expect(translateText('ติดต่อแอดมิน / แจ้งปัญหา')).toBe('Contact admin / Report a problem')
    expect(translateText('ค้นหาเลขรายการ ชื่อปัญหา หรือติดต่อกลับ')).toBe('Search issue ID, title, or contact')
    expect(translateText('20 รายการ')).toBe('20 items')
    expect(translateText('สมัครและส่ง verify email')).toBe('Register and send verification email')
    expect(translateText('ตั้งค่า Telegram webhook')).toBe('Set Telegram webhook')
  })

  it('restores translated controls to Thai', () => {
    setLanguage('en')
    expect(translateText('ส่งรายการแจ้งปัญหา')).toBe('Submit problem report')
    setLanguage('th')
    expect(translateText('Submit problem report')).toBe('ส่งรายการแจ้งปัญหา')
  })

  it('does not repeatedly translate text that contains its source phrase', () => {
    setLanguage('en')
    const translated = translateText('Telegram notification')
    expect(translated).toBe('Telegram notifications')
    expect(translateText(translated)).toBe('Telegram notifications')
    expect(translateText('เชื่อมต่อ SlipOK สำเร็จ')).toBe('SlipOK connected successfully')
  })

  it('never translates API/user data inside an explicit ignore boundary', async () => {
    document.body.innerHTML = '<main><span data-i18n-ignore>ประวัติ</span><b>ประวัติ</b></main>'
    setLanguage('en')
    const stop = installDomTranslator(() => document.querySelector('main'))
    await Promise.resolve()
    expect(document.querySelector('[data-i18n-ignore]').textContent).toBe('ประวัติ')
    expect(document.querySelector('b').textContent).toBe('History')
    stop()
  })
})
