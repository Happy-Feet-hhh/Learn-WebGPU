// 从shader源代码引入
import shaderSource from "./shaders/shader.wgsl?raw";

class Renderer {
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  // 新增 渲染管线对象
  private pipeline!: GPURenderPipeline;

  constructor() {}
  
  public async initialize(): Promise<void> {
    if (!navigator.gpu) {
      alert("WebGPU不受支持!");
    }

    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.context = canvas.getContext('webgpu')!;
    
    if(!this.context) {
      alert("当前画布不支持WebGPU上下文!");
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "low-power",
    })!;

    if (!adapter) {
      alert("无法找到合适的适配器(显卡)")
    }

    const info = adapter?.info;
    console.log("显卡的厂商:", info?.vendor);
    console.log("显卡的架构:", info?.architecture);

    this.device = await adapter?.requestDevice()!;
    
    
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });

    // 新增，准备shader module 着色器模块
    this.prepareModel();
  }

  // 新增 准备shaderModule 和 渲染管线
  private prepareModel(): void {
    const shaderModule = this.device.createShaderModule({
      code: shaderSource
    });

    const vertexState: GPUVertexState = {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: []
    };

    const fragmentState: GPUFragmentState = {
      module: shaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: navigator.gpu.getPreferredCanvasFormat()
        }
      ]
    };

    // 注意：WebGPU中不需要自己创建RenderPipeline的Layout, 因为可以auto
    // Render Pipeline Layout里保存了 bind_group相关的信息
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: vertexState,
      fragment: fragmentState,
      primitive: {
        topology: "triangle-list",
      }
    });
  }

  public draw() {
    const commandEncoder = this.device.createCommandEncoder();
    const rendePassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
          view: this.context.getCurrentTexture().createView()
        }
      ]
    };

    const passEncoder = commandEncoder.beginRenderPass(rendePassDescriptor);
    // DRAW HERE
    passEncoder.setPipeline(this.pipeline);
    passEncoder.draw(3); // draw 3 vertices

    passEncoder.end();

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);
  }
}

const renderer = new Renderer();
renderer.initialize().then(() => renderer.draw());