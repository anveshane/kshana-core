#!/usr/bin/env node
/**
 * Automated test for agentic loop with harness.
 * Demonstrates tool calls, todos, and multi-turn interaction.
 */
import WebSocket from 'ws';

const WS_URL = process.argv[2] || 'ws://127.0.0.1:3000/api/v1/ws/chat';

interface ServerMessage {
  type: string;
  sessionId: string;
  timestamp: number;
  data: any;
}

class HarnessLoopTest {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private messageCount = 0;
  private isComplete = false;

  async run(): Promise<void> {
    console.log('🚀 Harness Agentic Loop Test');
    console.log('============================\n');

    await this.connect();

    // Test 1: Simple task with tool calls (todo management)
    console.log('📝 Test 1: Task with Todo Management\n');
    await this.sendTask('Create a 3-step plan for making a sandwich');

    await this.wait(10000); // Wait for task to complete

    // Test 2: Context storage
    console.log('\n\n📦 Test 2: Context Storage\n');
    await this.sendTask('Store this information: "The robot name is R2-D2" with label "robot-info"');

    await this.wait(10000);

    console.log('\n\n✅ Test Complete!\n');
    this.close();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Connecting to ${WS_URL}...\n`);
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        console.log('✓ Connected!\n');
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log('\n❌ Connection closed');
        if (!this.isComplete) {
          process.exit(1);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg: ServerMessage = JSON.parse(raw);
      this.sessionId = msg.sessionId;
      this.messageCount++;

      switch (msg.type) {
        case 'status':
          const status = msg.data as { status: string; message?: string };
          console.log(`📊 [STATUS] ${status.status}${status.message ? ': ' + status.message : ''}`);
          break;

        case 'progress':
          const progress = msg.data as { iteration: number; maxIterations: number };
          console.log(`⏳ [PROGRESS] Iteration ${progress.iteration}/${progress.maxIterations}`);
          break;

        case 'stream_chunk':
          const chunk = msg.data as { content: string };
          process.stdout.write(chunk.content);
          break;

        case 'agent_text':
          const text = msg.data as { text: string; isFinal: boolean };
          if (text.isFinal) {
            console.log(`\n\n💬 [AGENT FINAL]: ${text.text}`);
          }
          break;

        case 'tool_call':
          const toolCall = msg.data as { toolName: string; arguments?: any };
          console.log(`\n🔧 [TOOL CALL] ${toolCall.toolName}`);
          if (toolCall.arguments) {
            console.log(`   Args: ${JSON.stringify(toolCall.arguments, null, 2)}`);
          }
          break;

        case 'tool_result':
          const toolResult = msg.data as { toolName: string; result: any };
          console.log(`✓ [TOOL RESULT] ${toolResult.toolName}`);
          console.log(`   Result: ${JSON.stringify(toolResult.result, null, 2)}`);
          break;

        case 'todo_update':
          const todoData = msg.data as { todos: Array<{ content: string; status: string; activeForm?: string }> };
          console.log('\n📋 [TODOS]');
          for (const todo of todoData.todos) {
            const status = todo.status === 'completed' ? '✓' :
                          todo.status === 'in_progress' ? '→' : '○';
            const text = todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
            console.log(`   ${status} ${text}`);
          }
          break;

        case 'agent_question':
          const question = msg.data as { question: string; isConfirmation: boolean };
          console.log(`\n❓ [QUESTION] ${question.question}`);
          // Auto-respond for testing
          setTimeout(() => {
            this.sendResponse('yes');
          }, 1000);
          break;

        case 'agent_response':
          const response = msg.data as { output: string; status: string };
          console.log(`\n📤 [RESPONSE] Status: ${response.status}`);
          if (response.output) {
            console.log(`Output: ${response.output.substring(0, 200)}${response.output.length > 200 ? '...' : ''}`);
          }
          break;

        case 'error':
          const error = msg.data as { code: string; message: string };
          console.error(`\n❌ [ERROR] ${error.code}: ${error.message}`);
          break;

        case 'agent_status':
          const agentStatus = msg.data as { status: string; agentName?: string };
          console.log(`🤖 [AGENT] ${agentStatus.agentName || 'agent'}: ${agentStatus.status}`);
          break;

        default:
          // Uncomment to see all messages
          // console.log(`\n[${msg.type}]`, JSON.stringify(msg.data, null, 2));
          break;
      }
    } catch (e) {
      console.error('Failed to parse message:', raw);
    }
  }

  private sendTask(task: string): void {
    console.log(`📨 Sending task: "${task}"\n`);
    this.send({
      type: 'start_task',
      data: { task },
    });
  }

  private sendResponse(response: string): void {
    console.log(`📨 Sending response: "${response}"\n`);
    this.send({
      type: 'user_response',
      data: { response },
    });
  }

  private send(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.error('❌ Not connected');
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private close(): void {
    this.isComplete = true;
    this.ws?.close();
    console.log(`\n📊 Total messages received: ${this.messageCount}`);
    process.exit(0);
  }
}

// Main
const test = new HarnessLoopTest();
test.run().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
