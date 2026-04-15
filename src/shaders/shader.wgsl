struct VertexOut {
    @builtin(position) position: vec4f, // 顶点在裁剪空间中的位置
    @location(0) color: vec4f,
    // 新增 在 fragment shader 的 slot 1 中插入纹理坐标数据
    @location(1) texCoords: vec2f,
}

@vertex
fn vertexMain(
    @location(0) pos: vec2f,    // 顶点的xy坐标
    @location(1) color: vec3f,  // rgb颜色值
    // 新增 在vertex shader 的 slot 2 中插入uv坐标数据，从GPUVertexBufferLayout.attributes.[shaderlocation]里拿到
    @location(2) texCoords: vec2f, // uv坐标数据
) -> VertexOut {
    var output: VertexOut;
    output.position = vec4f(pos, 0.0, 1.0);
    output.color = vec4f(color, 1.0);
    output.texCoords = texCoords;

    return output;
}

// 新增 创建纹理采样器 采样器可以指定 采样的方式，比如 linear 或者 nearest
@group(0) @binding(0)
var texSampler: sampler;
// 新增 创建texture 2d 对象，表示我们自己的纹理对象
@group(0) @binding(1)
var tex: texture_2d<f32>;

// 片段着色器会针对三角形中的每个像素进行调用。
@fragment
fn fragmentMain(fragData: VertexOut) -> @location(0) vec4f {
    // 新增 通过 纹理对象 纹理采样器 以及 坐标 得到每一个纹理像素的颜色
    var textureColor = textureSample(tex, texSampler, fragData.texCoords);
    return fragData.color * textureColor; // 像素的最终颜色
}