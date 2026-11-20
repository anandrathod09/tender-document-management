import { describe, expect, it } from 'vitest'
import { button, details, layout, p } from '../src/lib/email-templates'

describe('email templates', () => {
  it('escapes everything put into an email', () => {
    const html = layout({
      heading: 'Hi <b>',
      subheading: 'A & B',
      color: '#000',
      preheader: 'x',
      body:
        p('<script>alert(1)</script>') +
        details('T', [['Name', '"Asha"']], '#000') +
        button('https://x.test/?a=1&b="2"', 'Go', '#000'),
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Hi &lt;b&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('&quot;Asha&quot;')
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"')
  })
})
