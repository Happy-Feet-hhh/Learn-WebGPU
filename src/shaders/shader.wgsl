struct VertexOut {
    @builtin(position) position: vec4f, // 顶点在裁剪空间中的位置
    @location(0) color: vec4f
}

// 顶点着色器会针对顶点数组中的每个顶点执行一次。
// 顶点索引通过内置变量传入。
@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32
) -> VertexOut {
    // 创建三角形的顶点数据，后期从cpu侧(ts)中引入
    let pos = array(
        vec2f( 0.0,  0.5),  // 上中点
        vec2f(-0.5, -0.5),  // 左下点
        vec2f( 0.5, -0.5)   // 右下点
    );

    var output: VertexOut;
    output.position = vec4f(pos[vertexIndex].x, pos[vertexIndex].y, 0.0, 1.0);
    output.color = vec4f(1.0, 0.0, 0.0, 1.0);

    return output;
}

// 片段着色器会针对三角形中的每个像素进行调用。
@fragment
fn fragmentMain(fragData: VertexOut) -> @location(0) vec4f {
    return fragData.color; // 像素的最终颜色
}