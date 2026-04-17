// engine.ts - WebGPU 游戏引擎核心模块
// 负责初始化 WebGPU 设备、管理渲染循环、协调各子系统
// WebGPU 渲染流程：Canvas → Context → Adapter → Device → 渲染循环

import { Content } from "./content";
import { SpriteRenderer } from "../core/sprite-renderer";
import { InputManager } from "./input-manager";
import { vec2 } from "wgpu-matrix";
import { EffectsFactory } from "../effects/effects-factory";
import { Texture } from "../core/texture";

export class Engine {

  // 上一帧的时间戳，用于计算帧间时间差（delta time）
  private lastTime = 0;

  // HTML Canvas 元素，作为 WebGPU 的渲染目标
  private canvas!: HTMLCanvasElement;

  // WebGPU 画布上下文，用于配置渲染表面的格式并与 Canvas 关联
  private context!: GPUCanvasContext;

  // GPU 设备（逻辑设备），是与 GPU 通信的主要接口
  // 通过 adapter.requestDevice() 创建，用于创建缓冲区、纹理、着色器等 GPU 资源
  private device!: GPUDevice;

  // 渲染通道编码器，用于记录一帧中的所有绘制命令
  // 工作流程：createCommandEncoder → beginRenderPass → 绑定管线/绘制 → end → submit
  private passEncoder!: GPURenderPassEncoder;

  // 精灵渲染器，负责批量绘制 2D 精灵（纹理四边形）
  public spriteRenderer!: SpriteRenderer;

  // 输入管理器，监听键盘事件，提供按键状态查询
  public inputManager!: InputManager;

  // 特效工厂，用于创建后处理效果（如泛光 Bloom）
  public effectsFactory!: EffectsFactory;

  // 游戏的窗口大小（画布宽高）
  public gameBounds = vec2.create();

  // 每帧更新回调，参数 dt 为帧间隔时间（毫秒）
  // 游戏对象在此回调中更新逻辑（移动、碰撞检测等）
  public onUpdate: (dt: number) => void = () => { };

  // 每帧绘制回调，游戏对象在此回调中提交绘制命令
  public onDraw: () => void = () => { };

  // 目标纹理1：当为 null 时，场景直接渲染到屏幕（Canvas 的交换链纹理）；
  // 不为 null 时，场景渲染到这张离屏纹理上，用于后处理效果
  // 这是实现泛光（Bloom）效果的关键：先将场景渲染到离屏纹理，再对该纹理做模糊处理
  private destinationTexture?: GPUTexture | null = null;

  // 目标纹理2：第二个渲染目标，用于存储场景中的高亮部分（亮度信息）
  // 配合 destinationTexture 一起使用，作为多渲染目标（MRT）的第二个输出
  private destinationTexture2?: GPUTexture | null = null;


  // 设置场景的主渲染目标纹理
  // 用于将渲染输出重定向到后处理效果所需的离屏纹理
  public setDestinationTexture(texture?: GPUTexture, ): void {
    this.destinationTexture = texture;
  }

  // 设置第二个渲染目标纹理（亮度/高亮信息）
  public setDestinationTexture2(texture?: GPUTexture, ): void {
    this.destinationTexture2 = texture;
  }

  // 获取 Canvas 当前帧的纹理，即最终显示在屏幕上的纹理
  // WebGPU 的交换链（swap chain）机制：每帧自动提供一张新的纹理
  public getCanvasTexture() : GPUTexture
  {
    return this.context.getCurrentTexture();
  }

  public brightnessTexture2!: Texture;

  // 初始化 WebGPU 渲染管线和所有子系统
  // WebGPU 初始化流程：Canvas → Context → Adapter → Device → 配置 Context → 创建子系统
  public async initialize(): Promise<void> {

    // 获取页面上的 Canvas 元素
    this.canvas = document.getElementById("canvas") as HTMLCanvasElement;

    // 获取 WebGPU 上下文（类似 WebGL 的 getContext("webgl2")）
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;

    // 记录画布尺寸，供游戏对象做边界检测和布局计算
    this.gameBounds[0] = this.canvas.width;
    this.gameBounds[1] = this.canvas.height;

    if (!this.context) {
      console.error("WebGPU not supported");
      alert("WebGPU not supported");
      return;
    }

    // 请求 GPU 适配器（Adapter）：代表系统中的一个 GPU 硬件或软件模拟器
    // Adapter 是 Device 的工厂，提供该 GPU 的能力信息
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      console.error("No adapter found");
      alert("No adapter found");
      return;
    }

    // 请求 GPU 逻辑设备（Device）：应用程序通过 Device 与 GPU 通信
    // Device 是创建所有 GPU 资源（缓冲区、纹理、管线等）的入口
    this.device = await adapter.requestDevice();

    // 初始化内容管理器，加载所有游戏资源（纹理、精灵表、字体等）
    await Content.initialize(this.device);

    // 配置 Canvas 的 WebGPU 上下文
    // format: 使用浏览器推荐的纹理格式（通常是 bgra8unorm），确保最佳性能
    // 配置后，context.getCurrentTexture() 将返回该格式的纹理
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat()
    });

    // 创建精灵渲染器，传入设备、画布宽高用于设置正交投影矩阵
    this.spriteRenderer = new SpriteRenderer(this.device, this.canvas.width, this.canvas.height);
    this.spriteRenderer.initialize();

    // 创建输入管理器和特效工厂
    this.inputManager = new InputManager();
    this.effectsFactory = new EffectsFactory(this.device, this.canvas.width, this.canvas.height);

    // 创建一张空白纹理作为第二个渲染目标（亮度纹理），格式为 bgra8unorm
    this.destinationTexture2 = (await Texture.createEmptyTexture(this.device, this.canvas.width, this.canvas.height, "bgra8unorm")).texture;
  }

  // 主渲染循环：每帧执行一次
  // 游戏循环流程：requestAnimationFrame → 计算dt → 更新逻辑 → 记录命令 → 提交 → 请求下一帧
  public draw(): void {

    // 使用 performance.now() 获取高精度时间戳，计算帧间隔时间（delta time）
    // dt 用于让游戏逻辑与帧率解耦，确保不同帧率下运动速度一致
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;

    // 调用游戏逻辑更新回调
    this.onUpdate(dt);

    // 创建命令编码器：用于录制 GPU 命令
    // 命令编码器不会立即执行命令，而是记录命令列表，最后一次性提交给 GPU
    const commandEncoder = this.device.createCommandEncoder();

    // 根据是否设置了目标纹理，决定渲染到离屏纹理还是屏幕纹理
    // createView() 创建纹理视图，描述如何访问纹理（格式、维度等）
    const sceneTextureView = this.destinationTexture != null ? 
      this.destinationTexture.createView() :
      this.context.getCurrentTexture().createView();

    // 渲染通道描述符：定义渲染通道的配置
    // 这里使用了多渲染目标（MRT - Multiple Render Targets）：
    //   - colorAttachments[0]：场景颜色输出（主画面）
    //   - colorAttachments[1]：亮度信息输出（用于泛光效果）
    // MRT 允许片段着色器同时输出到多个纹理，是 Bloom 效果的基础
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          // 清屏颜色：浅灰色背景 (r:0.8, g:0.8, b:0.8)
          clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
          // loadOp: "clear" 表示渲染开始时清空纹理（而不是加载上一帧内容）
          loadOp: "clear",
          // storeOp: "store" 表示渲染结束后保留结果（而不是丢弃）
          storeOp: "store",
          // 第一个渲染目标：场景纹理
          view: sceneTextureView
        },
        {
          // 第二个渲染目标：亮度纹理，同样清屏为灰色
          clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
          view: this.destinationTexture2!.createView()
        }
      ]
    };

    // 开始渲染通道：返回渲染通道编码器
    // 从此时起，所有绘制命令都通过 passEncoder 记录
    this.passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    // 通知精灵渲染器开始新的一帧，设置渲染通道编码器
    this.spriteRenderer.framePass(this.passEncoder);

    // 调用游戏绘制回调，游戏对象在此提交精灵绘制命令
    this.onDraw();

    // 通知精灵渲染器结束本帧，执行批量绘制（flush 所有待处理的精灵）
    this.spriteRenderer.frameEnd();

    // 结束渲染通道，停止记录绘制命令
    this.passEncoder.end();

    // 将命令编码器中的所有命令打包为命令缓冲区，并提交到 GPU 队列执行
    // finish() 返回 GPUCommandBuffer，submit() 将其发送到 GPU 执行
    // 这是 WebGPU 的核心提交模式：先录制命令，再一次性提交
    this.device.queue.submit([commandEncoder.finish()]);

    // 请求浏览器在下一帧（vsync）时再次调用 draw，形成游戏循环
    window.requestAnimationFrame(() => this.draw());
  }



}
