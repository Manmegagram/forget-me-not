# Forget Me Not 🌼

แอปแฟลชการ์ดส่วนตัวแบบ Spaced Repetition (เหมือน Anki) ใช้บน iPhone ได้แบบ PWA ทำงาน offline และเก็บข้อมูลในเครื่องเท่านั้น

**เปิดแอป:** https://manmegagram.github.io/forget-me-not/

## ติดตั้งบน iPhone

1. เปิดลิงก์ด้านบนด้วย **Safari**
2. กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) → **Add to Home Screen / เพิ่มไปยังหน้าจอโฮม**
3. เปิดแอปจากไอคอนดอกไม้บนหน้าจอโฮม ใช้งานได้แม้ไม่มีอินเทอร์เน็ต

> ข้อมูลการ์ดอยู่ในเครื่องคุณเท่านั้น ถ้าลบแอปออกจากหน้าจอโฮมหรือล้างข้อมูล Safari การ์ดจะหาย (ฟีเจอร์ Backup มาในเฟส 4)

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
- `src/screens/` หน้าจอ Home, Study, Stats, Settings

ทุกครั้งที่ merge เข้า `main` GitHub Actions จะรัน test, build และ deploy ขึ้น GitHub Pages อัตโนมัติ
