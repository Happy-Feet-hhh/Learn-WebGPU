class Renderer {
  private context!: GPUCanvasContext;
  private device!: GPUDevice;

  public async initialize() {
    // 在初始化方法中准备画布canvas
    const canvas: HTMLCanvasElement = document.getElementById("canvas") as HTMLCanvasElement;
    // 调用画布的核心方法，请求创建 WebGPU 渲染上下文，渲染前必须通过canvas.getContext获取上下文
    // ! 为Typescript的非空类型断言
    this.context = canvas.getContext('webgpu')!;

    if (!this.context) {
      alert('WebGPU 在该环境不受支持!');
      return;
    }

    // 同样requestAdapter返回的是Promise<GPUAdapter | null>，所以需要判空
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "low-power"
    });

    if (!adapter) {
      alert("无法找到合适的适配器(显卡)")
    }

    // 使用info属性可以获取硬件的属性
    const info = await adapter?.info;
    console.log(info?.vendor);
    console.log(info?.architecture);

    // 显示所有adapter支持的特性
    adapter?.features.forEach((value) => {
      console.log(value);
    });

    // 逻辑设备，device是用户(我们)与adapter之间通信的接口
    this.device = await adapter?.requestDevice()!;

    // 它用于为画布设置设备的首选格式和尺寸。 作用：保证渲染颜色正确、不报错、性能最优，类似WPGU设置Surface
    // 每个画布调用一次该方法。它需要在其他所有 WebGPU 方法之前调用。
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat()
    });
  }

  public draw() {

    // WebGPU API 中的 GPUCommandEncoder 接口是所有命令编码器的基础接口。
    // 它用于创建命令缓冲区
    const commandEncoder = this.device.createCommandEncoder();


    // WebGPU API 的 GPURenderPassDescriptor 接口
    // 用于描述一个渲染通道。
    // 它用于创建渲染通道编码器。
    const renderPassDescriptor: GPURenderPassDescriptor = {
      // WebGPU API 的 GPURenderPassDescriptor 接口的 colorAttachments 属性是一个颜色附件数组。
      // 它用于描述渲染通道的颜色附件。
      // 它用于创建渲染通道编码器。
      colorAttachments: [
        {
          // clearColor 用于描述纹理将被清除为的颜色。
          clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
          // loadOp 用于描述纹理将如何加载，在本例中，我们正在清空纹理
          loadOp: "clear", 
          // toreOp 用于描述纹理的存储方式。在这种情况下，我们正在存储该纹理。
          storeOp: "store",
          // 视图用于描述将被渲染到的纹理。
          view: this.context.getCurrentTexture().createView()
        }
      ]
    };

    // beginRenderPass 用于创建渲染通道编码器。
    // 每个渲染通道调用一次该方法。
    // passEncoder 用于为渲染通道编码指令。
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    // DRAW HERE 以后渲染的代码在这里填充
    // END DRAW

    // endPass 用于结束渲染通道编码器。
    passEncoder.end();
    
    // submit 用于向图形处理器（GPU）提交命令缓冲区。
    // commandEncoder.finish () 用于创建命令缓冲区。
    this.device.queue.submit([commandEncoder.finish()]);
  }
}

const renderer = new Renderer();

// 由于渲染器Renderer的初始化是异步的，所以我们直接调用then方法
// 当它初始化完成后立马调用draw()
renderer.initialize().then(() => renderer.draw());