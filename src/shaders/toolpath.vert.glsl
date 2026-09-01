/**
 * Expands one toolpath segment into a camera-facing ribbon.
 *
 * Each segment is an instance of a 4-vertex triangle strip: aCorner.x picks
 * the start (0) or end (1) of the segment, aCorner.y the side (-1 or +1).
 * The ribbon is widened to the bead's real deposited width, with a pixel
 * floor so a 0.42 mm line stays visible when the whole model fits on screen.
 *
 * Projection is rebuilt from the camera basis rather than a matrix so it
 * matches the raymarcher's ray construction exactly (see renderer.frag.glsl):
 * the same forward/right/up and focal length produce the same image plane.
 */

attribute vec2 aCorner;
attribute vec3 aStart;
attribute vec3 aEnd;
/** halfWidth, halfHeight (scene units), travel flag, layer index. */
attribute vec4 aMeta;
attribute float aValue;

uniform vec3 uCameraPos;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;
uniform float uFocalLength;
uniform float uAspect;
uniform float uViewportHeight;
uniform float uNear;
uniform float uFar;
uniform float uValueMin;
uniform float uValueMax;
uniform float uWidthScale;
uniform float uTravelWidthScale;
uniform float uMinPixelWidth;
uniform float uShowTravels;

varying float vSide;
varying float vRampT;
varying float vTravel;
varying vec3 vSideDir;
varying vec3 vViewDir;
varying float vResolved;

void main() {
    float z0 = dot(aStart - uCameraPos, uCameraForward);
    float z1 = dot(aEnd - uCameraPos, uCameraForward);
    bool hiddenTravel = aMeta.z > 0.5 && uShowTravels < 0.5;

    if (hiddenTravel || (z0 < uNear && z1 < uNear)) {
        // Behind the near plane, or a travel while travels are hidden:
        // collapse the instance so it is clipped away entirely.
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        vSide = 0.0;
        vRampT = 0.0;
        vTravel = 0.0;
        vSideDir = vec3(1.0, 0.0, 0.0);
        vViewDir = vec3(0.0, 0.0, 1.0);
        vResolved = 0.0;
        return;
    }

    // Clip the segment to the near plane in world space so the surviving
    // part still projects correctly.
    vec3 p0 = aStart;
    vec3 p1 = aEnd;
    if (z0 < uNear) {
        p0 = mix(aStart, aEnd, (uNear - z0) / (z1 - z0));
    } else if (z1 < uNear) {
        p1 = mix(aEnd, aStart, (uNear - z1) / (z0 - z1));
    }

    vec3 delta = p1 - p0;
    float segmentLength = length(delta);
    vec3 axis = segmentLength > 1e-9 ? delta / segmentLength : uCameraRight;

    vec3 world = mix(p0, p1, aCorner.x);
    vec3 toCamera = uCameraPos - world;
    float toCameraLength = length(toCamera);
    vec3 viewDir = toCameraLength > 1e-9 ? toCamera / toCameraLength : uCameraForward;

    vec3 side = cross(axis, viewDir);
    float sideLength = length(side);
    // Segment pointing straight at the camera: any perpendicular will do.
    side = sideLength > 1e-6 ? side / sideLength : uCameraRight;

    float camZ = max(uNear, dot(world - uCameraPos, uCameraForward));
    float worldPerPixel = (2.0 * camZ) / (uFocalLength * uViewportHeight);

    float isTravel = step(0.5, aMeta.z);
    float widthScale = mix(uWidthScale, uTravelWidthScale, isTravel);

    // An extruded bead is not round: it is about a line width across the
    // layer plane and only a layer height tall. Sizing the ribbon by the
    // width in every direction made each bead twice as tall as its layer
    // spacing, so neighbouring revolutions overlapped and fought for the
    // depth buffer - a hard tonal seam at the camera's horizon, where which
    // half of the bead won flipped over, with a band of z-fighting along it.
    //
    // So the half-extent is read off the bead's real elliptical section:
    // aMeta.x across the layer, aMeta.y between layers, evaluated in the
    // direction the ribbon actually expands.
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 inLayer = cross(up, axis);
    float horizontality = length(inLayer);
    inLayer = horizontality > 1e-5 ? inLayer / horizontality : uCameraRight;
    vec3 betweenLayers = normalize(cross(axis, inLayer));

    float semiAcross = max(1e-7, aMeta.x * widthScale);
    // A vertical move has no "between layers" direction of its own; its
    // section is the round-ish end of the bead instead.
    float semiBetween = max(1e-7, mix(aMeta.x, aMeta.y, horizontality) * widthScale);

    float alongInLayer = dot(side, inLayer) / semiAcross;
    float alongBetween = dot(side, betweenLayers) / semiBetween;
    float sectionRadius = inversesqrt(max(1e-12, alongInLayer * alongInLayer + alongBetween * alongBetween));

    float minRadius = 0.5 * uMinPixelWidth * worldPerPixel;
    float halfWidth = max(sectionRadius, minRadius);

    // Below about two pixels of layer spacing the beads stop being separable
    // and the pixel floor forces them to overlap again. The fragment shader
    // uses this to fade out per-bead roundness at those scales, leaving the
    // macro surface shading - otherwise the same seam returns when zoomed out.
    vResolved = smoothstep(1.0, 3.0, (2.0 * sectionRadius) / max(1e-9, worldPerPixel));

    // Overlap consecutive segments by half a bead so turns close up instead
    // of showing a wedge of background at every joint.
    float extend = min(halfWidth, segmentLength * 0.5);
    world += axis * ((aCorner.x - 0.5) * 2.0) * extend;
    world += side * (halfWidth * aCorner.y);

    vec3 rel = world - uCameraPos;
    float cx = dot(rel, uCameraRight);
    float cy = dot(rel, uCameraUp);
    float cz = max(uNear, dot(rel, uCameraForward));
    float depth = ((uFar + uNear) / (uFar - uNear)) * cz - (2.0 * uFar * uNear) / (uFar - uNear);

    gl_Position = vec4(cx * uFocalLength / uAspect, cy * uFocalLength, depth, cz);

    vSide = aCorner.y;
    vTravel = isTravel;
    vSideDir = side;
    vViewDir = viewDir;
    vRampT = clamp((aValue - uValueMin) / max(1e-9, uValueMax - uValueMin), 0.0, 1.0);
}
