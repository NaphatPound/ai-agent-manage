# AI Agentic Orchestrator - Project Plan

## Project Goal
สร้างระบบ AI Assistant ที่สามารถ:
- แยกแยะเจตนาผู้ใช้ (Intent Classification)
- ดึงข้อมูลจาก Knowledge Base (RAG)
- เรียกใช้ API/เครื่องมือภายนอก (MCP)
- สนทนาทั่วไป (General Chat)

โดยใช้ **Ollama Cloud** เป็น LLM หลัก

---

## Phase 1: Project Setup & Foundation
- [ ] เลือก Tech Stack: **TypeScript (Vercel AI SDK + MCP SDK)** หรือ **Python (LangGraph + Ollama SDK)**
- [ ] สร้างโครงสร้างโปรเจกต์ (folder structure, package.json / pyproject.toml)
- [ ] ตั้งค่า Ollama Cloud API Key และ environment variables
- [ ] ตั้งค่า Database: PostgreSQL + pgvector extension
- [ ] สร้าง basic chat endpoint ที่เชื่อมกับ Ollama Cloud

## Phase 2: Intent Classification (Router / Orchestrator)
- [ ] สร้าง Classifier module ที่ใช้ Ollama Cloud + Structured Output (JSON)
- [ ] กำหนด Intent types: `rag`, `mcp`, `chat`
- [ ] สร้าง Router logic เพื่อส่งต่อไปยัง module ที่ถูกต้อง
- [ ] ทดสอบ classification accuracy กับตัวอย่างประโยคหลากหลาย

## Phase 3: RAG System (Knowledge Retrieval)
- [ ] ตั้งค่า Vector Database (pgvector บน PostgreSQL)
- [ ] เลือก Embedding model จาก Ollama Cloud (เช่น `nomic-embed-text`)
- [ ] สร้าง Document ingestion pipeline (text -> chunks -> embeddings -> store)
- [ ] สร้าง Retrieval module: query -> semantic search -> top-k results
- [ ] สร้าง Context Injection: รวม retrieved docs เข้า prompt แล้วส่งให้ LLM สรุป

## Phase 4: MCP Integration (Action Execution)
- [ ] สร้าง MCP Server พร้อม Tool definitions (name, description, parameters)
- [ ] นิยาม Skills เริ่มต้น เช่น:
  - Map/Location API
  - Calendar API
  - Stock/Inventory API
  - Email/Notification
- [ ] เชื่อมต่อ Ollama Cloud Function Calling กับ MCP Tools
- [ ] ทดสอบ Tool selection accuracy

## Phase 5: Multi-Task Orchestration
- [ ] รองรับการแยก 1 ข้อความเป็นหลาย tasks (เช่น "เช็คสต็อก + ดูคู่มือ")
- [ ] สร้าง Execution Plan ที่รันหลาย path พร้อมกัน (RAG + MCP)
- [ ] รวมผลลัพธ์จากหลายแหล่งแล้วให้ LLM synthesize คำตอบสุดท้าย

## Phase 6: Web UI & Streaming
- [ ] สร้าง Web UI สำหรับ Chat (React / Next.js)
- [ ] รองรับ Streaming response จาก Ollama Cloud
- [ ] แสดง status ว่ากำลังใช้ RAG หรือ MCP อยู่

## Phase 7: Logging, Feedback & Optimization
- [ ] เก็บ Log ว่า AI เลือก Skill ถูกต้องหรือไม่
- [ ] เก็บ Chat History ใน PostgreSQL
- [ ] ปรับปรุง Tool descriptions ตาม feedback
- [ ] ทดสอบ latency และ optimize routing (ใช้ model เล็กสำหรับ classification ถ้าจำเป็น)

---

## Tech Stack Summary

| Component          | Technology                                      |
| ------------------ | ----------------------------------------------- |
| LLM Provider       | Ollama Cloud (llama3, deepseek-v3)              |
| Embedding          | Ollama Cloud (nomic-embed-text)                 |
| Orchestration (TS) | Vercel AI SDK + MCP SDK                         |
| Orchestration (PY) | LangGraph + Ollama SDK                          |
| Database           | PostgreSQL + pgvector                           |
| Web UI             | React / Next.js                                 |
| OS                 | Ubuntu (dev & deploy) / macOS (local dev)       |

---

## Architecture Overview

```
User Input
    |
    v
[Orchestrator / Router]
    |-- Ollama Cloud (Structured Output JSON)
    |-- Intent: rag / mcp / chat
    |
    +---> [RAG Path]
    |       |-- Embedding (Ollama Cloud)
    |       |-- Vector Search (pgvector)
    |       |-- Context Injection -> LLM Summary
    |
    +---> [MCP Path]
    |       |-- MCP Server (Tool Registry)
    |       |-- Function Calling -> API Execution
    |       |-- Result -> LLM Summary
    |
    +---> [Chat Path]
            |-- Chat History / Memory
            |-- Direct LLM Response
    |
    v
Final Response (Streaming)
```

---

## Next Steps
1. ตัดสินใจเลือก TypeScript หรือ Python
2. สมัคร Ollama Cloud API Key
3. เริ่ม Phase 1: Project Setup
