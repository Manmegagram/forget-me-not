# Forget Me Not 🌼

แอปแฟลชการ์ดส่วนตัวแบบ Spaced Repetition (เหมือน Anki) ใช้บน iPhone ได้แบบ PWA ทำงาน offline และเก็บข้อมูลในเครื่องเท่านั้น

**เปิดแอป:** https://manmegagram.github.io/forget-me-not/

## ติดตั้งบน iPhone

1. เปิดลิงก์ด้านบนด้วย **Safari**
2. กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) → **Add to Home Screen / เพิ่มไปยังหน้าจอโฮม**
3. เปิดแอปจากไอคอนดอกไม้บนหน้าจอโฮม ใช้งานได้แม้ไม่มีอินเทอร์เน็ต

> ข้อมูลการ์ดอยู่ในเครื่องคุณเท่านั้น ถ้าลบแอปออกจากหน้าจอโฮมหรือล้างข้อมูล Safari การ์ดจะหาย (ฟีเจอร์ Backup มาในเฟส 4)

## สร้างการ์ดด้วย AI

กด **สร้างการ์ดด้วย AI** ที่หน้าแรก แล้วพิมพ์หัวข้อ วางข้อความ หรือแนบรูปหน้าหนังสือ Claude จะร่างการ์ดให้ (ครั้งละไม่เกิน 50 ใบ) จากนั้นกด **ตรวจและนำเข้า** เพื่อแก้ไข ลบ เพิ่มการ์ด เลือก Deck และจัดการการ์ดซ้ำก่อนนำเข้า

- ต้องใช้ Claude API key ของคุณเอง: สร้างได้ที่ [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) หลังเติมเครดิตใน Billing แล้วนำมาวางใน **ตั้งค่า → Claude API key** (key เก็บในเครื่องนี้เท่านั้น)
- ค่าใช้จ่ายจ่ายตามการใช้งานกับ Anthropic โดยตรง แอปแสดงค่าใช้จ่ายโดยประมาณของแต่ละข้อความและยอดรวมในหน้าตั้งค่า
- ถ้าไม่อยากใช้ API key: เมนู **⋯ → คัดลอก prompt ไปใช้ในแอป Claude** แล้ววาง JSON ที่ได้กลับมาด้วย **นำเข้า JSON**

## รูปแบบ JSON สำหรับนำเข้า

```json
{
  "deck": "TOEIC Finance",
  "tags": ["toeic", "finance"],
  "cards": [
    { "front": "Revenue", "back": "รายได้", "note": "Annual revenue rose 10%." },
    { "front": "Invoice", "back": "ใบแจ้งหนี้", "type": "reverse" },
    { "front": "Accrual", "back": "accrual", "type": "typein" },
    { "text": "Ohm's law: {{c1::V}} = {{c2::I}} × R", "extra": "$V = IR$" }
  ]
}
```

| `type` | การ์ดที่ได้ |
| --- | --- |
| `basic` (ค่าเริ่มต้น) | หน้า → หลัง |
| `reverse` | หน้า → หลัง และ หลัง → หน้า |
| `optionalReverse` | เหมือน basic แต่ถ้าใส่ `"reverse": true` จะได้การ์ดกลับด้านด้วย |
| `typein` | พิมพ์คำตอบแล้วเทียบทีละตัวอักษร |
| `cloze` | ใช้ `text` ที่มี `{{c1::คำตอบ}}` หรือ `{{c1::คำตอบ::คำใบ้}}` ได้ 1 การ์ดต่อเลข c |
| `imageOcclusion` | ใช้ `image` (URL) และ `masks`: `[{"x":0.1,"y":0.2,"w":0.2,"h":0.1,"label":"..."}]` (ค่าเป็นสัดส่วน 0–1) |

ใส่ Markdown พื้นฐาน (`**ตัวหนา**`, `*เอียง*`, รายการ `-`), รูป `![](https://...)` และสูตร `$...$` / `$$...$$` ได้ ชื่อ Deck ใช้ `A::B` เพื่อสร้าง sub-deck ตัวอย่างไฟล์อยู่ที่ [`samples/starter-deck.json`](samples/starter-deck.json)

## สำหรับนักพัฒนา

```bash
npm install
npm run dev      # เปิดที่ http://localhost:5173
npm test         # unit tests ของ SRS engine และฐานข้อมูล
npm run build    # build สำหรับ GitHub Pages (base /forget-me-not/)
```

- `src/srs/` SRS engine (SM-2 แบบ Anki) เป็นโมดูลอิสระ ไม่ผูกกับ UI หรือฐานข้อมูล ต่อ FSRS ผ่าน `Scheduler` interface ได้
- `src/db/` IndexedDB (Dexie), คิวทบทวนพร้อม daily limit, import JSON + ตรวจซ้ำ
- `src/cards/` ประเภทโน้ต, Markdown/KaTeX renderer
- `src/ai/` Claude API (เรียกจากเบราว์เซอร์ด้วย key ของผู้ใช้, structured outputs, streaming), system prompt, สถานะแชตและร่างการ์ด
- `src/screens/` หน้าจอ Home, Study, Stats, Settings

ทุกครั้งที่ merge เข้า `main` GitHub Actions จะรัน test, build และ deploy ขึ้น GitHub Pages อัตโนมัติ
