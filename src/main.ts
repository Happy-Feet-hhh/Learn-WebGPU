async function initWebGPU() {
  // 1. 检查浏览器WebGPU支持
  if (!navigator.gpu) {
    throw new Error('当前浏览器不支持WebGPU');
  }

  // 2. 请求GPU适配器
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('无法获取GPU适配器');
  }

  // 3. 创建GPU设备
  const device = await adapter.requestDevice();

  // 4. 配置canvas上下文
  const canvas = document.querySelector('canvas')!;
  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  
  context.configure({
    device,
    format,
    alphaMode: 'opaque'
  });

  console.log('WebGPU初始化成功！', device);
  return { device, context, format };
}

// 页面加载完成后初始化
window.addEventListener('load', () => {
  initWebGPU().catch(err => console.error('WebGPU初始化失败:', err));
});