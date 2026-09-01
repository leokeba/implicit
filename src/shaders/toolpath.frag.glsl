/**
 * Shades the ribbon as a round bead.
 *
 * The flat strip is given a cylindrical cross-section normal derived from how
 * far across the ribbon the fragment sits, which is what makes a stack of
 * extrusions read as deposited material rather than as wireframe. Lighting is
 * deliberately shallow: the colour carries the data, so shading may separate
 * beads but must not push two ramp values to the same pixel value.
 */

precision highp float;

varying float vSide;
varying float vRampT;
varying float vTravel;
varying vec3 vSideDir;
varying vec3 vViewDir;
varying float vResolved;

uniform sampler2D uRamp;
uniform vec3 uLightDir;
uniform vec3 uTravelColor;
uniform float uShadeStrength;

void main() {
    // Fading `across` to zero collapses the bead normal onto the direction
    // facing the camera perpendicular to the path - which is the macro
    // surface normal of the wall the beads make up. So an unresolved stack
    // shades as the solid it approximates, and only resolved beads get their
    // own roundness.
    float across = clamp(vSide, -1.0, 1.0) * vResolved;
    float facing = sqrt(max(0.0, 1.0 - across * across));

    vec3 viewDir = normalize(vViewDir);
    vec3 normal = normalize(vSideDir * across + viewDir * facing);

    vec3 base = texture2D(uRamp, vec2(vRampT, 0.5)).rgb;
    base = mix(base, uTravelColor, vTravel);

    vec3 lightDir = normalize(uLightDir);
    // Half lambert: no fully black side, so the ramp stays legible all round.
    float lambert = 0.55 + 0.45 * max(0.0, dot(normal, lightDir));
    vec3 halfVector = normalize(lightDir + viewDir);
    float specular = pow(max(0.0, dot(normal, halfVector)), 24.0) * 0.22;
    // Darkened silhouette gives each bead an edge against its neighbours -
    // only worth drawing when the beads are separable in the first place.
    float rim = pow(1.0 - facing, 3.0) * 0.3 * vResolved;

    vec3 color = base * mix(1.0, lambert, uShadeStrength) * (1.0 - rim);
    color += specular * uShadeStrength;

    gl_FragColor = vec4(color, 1.0);
}
