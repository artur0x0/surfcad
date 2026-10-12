import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import {
  FEA_FACE_HIGHLIGHT_NAME,
  FEA_FIXTURE_HIGHLIGHT_COLOR,
  FEA_LOAD_HIGHLIGHT_COLOR,
  createFaceHighlightMesh,
  disposeHighlightObject,
  faceHighlightTargets,
  hostForHighlight,
  reconcileFaceHighlights,
  syncFeaFaceHighlights,
} from './faceHighlight.js';
import { FEA_LOAD_ARROW_NAME, FEA_LOAD_ARROWS_NAME } from './loadArrows.js';

function fakeMesh(id) {
  const mesh = {
    uuid: id,
    geometry: { uuid: `${id}-geom` },
    parent: { name: 'scene' },
    children: [],
    add(child) {
      child.parent = mesh;
      this.children.push(child);
    },
    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child.parent === mesh) child.parent = null;
    },
  };
  return mesh;
}

function fakeOverlay(id) {
  return {
    id,
    name: '',
    parent: null,
    userData: {},
    geometry: { disposed: 0, dispose() { this.disposed += 1; } },
    material: { disposed: 0, dispose() { this.disposed += 1; } },
    children: [],
    raycast: null,
    frustumCulled: true,
  };
}

test('targets key one overlay per fixture or load face', () => {
  const targets = faceHighlightTargets({
    fixtures: [{ faces: [{ part: 'a' }, { part: 'b' }] }],
    loads: [{ faces: [{ part: 'b' }] }, { faces: [{}] }],
  });
  assert.deepEqual(targets.map((row) => row.key), [
    'fixture:0:0',
    'fixture:0:1',
    'load:0:0',
    'load:1:0',
  ]);
  assert.equal(targets[0].partId, 'a');
  assert.equal(targets[3].partId, '');
  assert.deepEqual(faceHighlightTargets(null), []);
});

test('a part id selects that host, and a part-scope face uses the active solid', () => {
  const active = { id: 'a', active: true, mesh: {} };
  const other = { id: 'b', active: false, mesh: {} };
  assert.equal(hostForHighlight([active, other], { partId: 'b' }), other);
  assert.equal(hostForHighlight([active, other], { partId: '' }), active);
  assert.equal(hostForHighlight([other, { id: 'c', mesh: {} }], { partId: '' }), null);
  assert.equal(hostForHighlight([other], { partId: '' }), other);
  assert.equal(hostForHighlight([active], { partId: 'missing' }), null);
  const parked = { id: 'a', active: false, mesh: {} };
  const swapped = { id: 'b', active: true, mesh: {} };
  assert.equal(hostForHighlight([parked, swapped], { partId: '' }, 'a'), parked);
  assert.equal(hostForHighlight([swapped], { partId: '' }, 'a'), null);
});

test('reconcile keeps a matching key and disposes one that left', () => {
  const host = fakeMesh('part');
  const kept = fakeOverlay('kept');
  const dropped = fakeOverlay('dropped');
  host.add(kept);
  host.add(dropped);
  const overlays = new Map([
    ['fixture:0:0', { signature: 'same', hostMesh: host, mesh: kept }],
    ['load:0:0', { signature: 'old', hostMesh: host, mesh: dropped }],
  ]);
  let created = 0;
  const result = reconcileFaceHighlights(overlays, [
    { key: 'fixture:0:0', signature: 'same', hostMesh: host, create: () => { created += 1; return fakeOverlay('new'); } },
    { key: 'fixture:0:0', signature: 'dup', hostMesh: host, create: () => { created += 1; return fakeOverlay('dup'); } },
  ], {
    dispose: disposeHighlightObject,
    attach: (mesh, spec) => spec.hostMesh.add(mesh),
  });
  assert.equal(created, 0);
  assert.deepEqual(result.kept, ['fixture:0:0']);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.removed, ['load:0:0']);
  assert.equal(result.overlays.get('fixture:0:0').mesh, kept);
  assert.equal(dropped.parent, null);
  assert.equal(dropped.geometry.disposed, 1);
  assert.equal(dropped.material.disposed, 1);
  assert.equal(kept.geometry.disposed, 0);
  assert.deepEqual(host.children, [kept]);
});

test('a signature change replaces the mesh and disposes the old geometry', () => {
  const host = fakeMesh('part');
  const old = fakeOverlay('old');
  const edge = fakeOverlay('edge');
  old.children = [edge];
  host.add(old);
  const overlays = new Map([
    ['fixture:0:0', { signature: 'before', hostMesh: host, mesh: old }],
  ]);
  const replacement = fakeOverlay('next');
  const result = reconcileFaceHighlights(overlays, [{
    key: 'fixture:0:0',
    signature: 'after',
    hostMesh: host,
    create: () => replacement,
  }], {
    dispose: disposeHighlightObject,
    attach: (mesh, spec) => spec.hostMesh.add(mesh),
  });
  assert.equal(old.geometry.disposed, 1);
  assert.equal(old.material.disposed, 1);
  assert.equal(edge.geometry.disposed, 1);
  assert.equal(edge.material.disposed, 1);
  assert.equal(result.overlays.get('fixture:0:0').mesh, replacement);
  assert.equal(replacement.parent, host);
  assert.equal(replacement.name, FEA_FACE_HIGHLIGHT_NAME);
  assert.equal(replacement.userData.feaHighlightKey, 'fixture:0:0');
  assert.deepEqual(result.created, ['fixture:0:0']);
});

test('sync parents each face to its part and a second pass does not stack', () => {
  const partA = fakeMesh('a');
  const partB = fakeMesh('b');
  const contact = fakeOverlay('contact');
  contact.name = 'fea-contact';
  partA.add(contact);
  const hosts = [
    { id: 'a', active: true, mesh: partA },
    { id: 'b', active: false, mesh: partB },
  ];
  const study = {
    fixtures: [{ faces: [{ part: 'a' }] }, { faces: [{ part: 'a' }] }],
    loads: [{ faces: [{ part: 'b' }] }],
  };
  const options = {
    resolveTriangles: (host) => (host.id === 'b' ? [4] : [1, 2]),
    createMesh: (_host, _triangles, target) => fakeOverlay(target.key),
  };
  const first = syncFeaFaceHighlights(new Map(), study, hosts, options);
  assert.deepEqual(first.created, ['fixture:0:0', 'fixture:1:0', 'load:0:0']);
  assert.equal(partA.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 2);
  assert.equal(partB.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 1);
  assert.equal(contact.parent, partA);
  assert.equal(contact.geometry.disposed, 0);

  const keptLoad = first.overlays.get('load:0:0').mesh;
  const second = syncFeaFaceHighlights(first.overlays, study, hosts, options);
  assert.deepEqual(second.created, []);
  assert.equal(second.kept.length, 3);
  assert.equal(second.overlays.get('load:0:0').mesh, keptLoad);
  assert.equal(partA.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 2);

  const withoutLoad = {
    fixtures: study.fixtures,
    loads: [],
  };
  const third = syncFeaFaceHighlights(second.overlays, withoutLoad, hosts, options);
  assert.deepEqual(third.removed, ['load:0:0']);
  assert.equal(keptLoad.parent, null);
  assert.equal(keptLoad.geometry.disposed, 1);
  assert.equal(partB.children.length, 0);
  assert.equal(third.overlays.size, 2);
  assert.equal(contact.parent, partA);
  assert.equal(contact.geometry.disposed, 0);

  const cleared = syncFeaFaceHighlights(third.overlays, null, hosts, options);
  assert.equal(cleared.overlays.size, 0);
  assert.equal(partA.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 0);
  assert.equal(contact.parent, partA);
});

test('a built overlay is disposed with its outline and leaves the contact skin', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  const hostMesh = new Mesh(geometry, new MeshBasicMaterial());
  const contactGeometry = new BufferGeometry();
  const contact = new Mesh(contactGeometry, new MeshBasicMaterial());
  contact.name = 'fea-contact';
  hostMesh.add(contact);
  let contactDisposed = 0;
  const contactDispose = contactGeometry.dispose.bind(contactGeometry);
  contactGeometry.dispose = () => {
    contactDisposed += 1;
    contactDispose();
  };

  const hosts = [{ id: 'left', active: true, mesh: hostMesh }];
  const other = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
  hosts.push({ id: 'right', active: false, mesh: other });
  const study = {
    fixtures: [{ faces: [{ part: 'left' }] }],
    loads: [{ faces: [{ part: 'right' }] }],
  };
  const options = { resolveTriangles: () => [0] };
  const synced = syncFeaFaceHighlights(new Map(), study, hosts, options);
  assert.equal(synced.overlays.size, 1);
  const record = synced.overlays.get('fixture:0:0');
  assert.equal(record.mesh.parent, hostMesh);
  assert.equal(record.mesh.name, FEA_FACE_HIGHLIGHT_NAME);
  assert.equal(other.children.length, 0);
  const direct = createFaceHighlightMesh(geometry, [0]);
  assert.equal(direct.name, FEA_FACE_HIGHLIGHT_NAME);
  assert.ok(direct.children.some((child) => child.name === `${FEA_FACE_HIGHLIGHT_NAME}-edge`));

  const fillGeometry = record.mesh.geometry;
  const fillMaterial = record.mesh.material;
  const edge = record.mesh.children[0];
  let fillG = 0;
  let fillM = 0;
  let edgeG = 0;
  let edgeM = 0;
  const fillGDispose = fillGeometry.dispose.bind(fillGeometry);
  const fillMDispose = fillMaterial.dispose.bind(fillMaterial);
  fillGeometry.dispose = () => { fillG += 1; fillGDispose(); };
  fillMaterial.dispose = () => { fillM += 1; fillMDispose(); };
  const edgeGDispose = edge.geometry.dispose.bind(edge.geometry);
  const edgeMDispose = edge.material.dispose.bind(edge.material);
  edge.geometry.dispose = () => { edgeG += 1; edgeGDispose(); };
  edge.material.dispose = () => { edgeM += 1; edgeMDispose(); };

  const again = syncFeaFaceHighlights(synced.overlays, study, hosts, options);
  assert.equal(again.overlays.get('fixture:0:0').mesh, record.mesh);
  assert.equal(hostMesh.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 1);

  const cleared = syncFeaFaceHighlights(again.overlays, { fixtures: [], loads: [] }, hosts, options);
  assert.equal(cleared.overlays.size, 0);
  assert.equal(record.mesh.parent, null);
  assert.equal(fillG, 1);
  assert.equal(fillM, 1);
  assert.equal(edgeG, 1);
  assert.equal(edgeM, 1);
  assert.equal(contactDisposed, 0);
  assert.equal(contact.parent, hostMesh);
  disposeHighlightObject(direct);
  assert.equal(record.mesh.material.color.getHex(), FEA_FIXTURE_HIGHLIGHT_COLOR);
});

test('fixtures are blue and loads are yellow', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  const fixture = createFaceHighlightMesh(geometry, [0]);
  const load = createFaceHighlightMesh(geometry, [0], FEA_LOAD_HIGHLIGHT_COLOR);
  assert.equal(fixture.material.color.getHex(), FEA_FIXTURE_HIGHLIGHT_COLOR);
  assert.equal(fixture.children[0].material.color.getHex(), FEA_FIXTURE_HIGHLIGHT_COLOR);
  assert.equal(load.material.color.getHex(), FEA_LOAD_HIGHLIGHT_COLOR);
  assert.equal(load.children[0].material.color.getHex(), FEA_LOAD_HIGHLIGHT_COLOR);
  disposeHighlightObject(fixture);
  disposeHighlightObject(load);
});

test('a missing face map, a detached parent, or a throwing create does not attach', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    4, 0, 0,
    0, 4, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  const bare = new Mesh(geometry, new MeshBasicMaterial());
  const hosts = [{ id: 'a', active: true, mesh: bare }];
  const study = { fixtures: [{ faces: [{ part: 'a' }] }], loads: [] };
  const missing = syncFeaFaceHighlights(new Map(), study, hosts);
  assert.equal(missing.overlays.size, 0);
  assert.equal(bare.children.length, 0);

  const detached = fakeMesh('gone');
  detached.parent = null;
  const detachedHosts = [{ id: 'gone', active: false, mesh: detached, faceIDs: [1] }];
  const skipped = syncFeaFaceHighlights(new Map(), {
    fixtures: [{ faces: [{ part: 'gone' }] }],
  }, detachedHosts, { resolveTriangles: () => [0] });
  assert.equal(skipped.overlays.size, 0);
  assert.equal(detached.children.length, 0);

  const host = fakeMesh('part');
  host.faceIDs = [1];
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    const threw = syncFeaFaceHighlights(new Map(), {
      fixtures: [{ faces: [{ part: 'part' }] }],
    }, [{ id: 'part', active: true, mesh: host, faceIDs: [1] }], {
      resolveTriangles: () => [0],
      createMesh: () => { throw new Error('bad triangles'); },
    });
    assert.equal(threw.overlays.size, 0);
    assert.equal(host.children.length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /ignored a bad face highlight/);
  } finally {
    console.error = orig;
  }

  const hidden = syncFeaFaceHighlights(new Map(), {
    fixtures: [{ faces: [{ part: 'other' }] }, { faces: [{}] }],
    loads: [{ faces: [{ part: 'part' }] }],
  }, [{ id: 'part', active: true, mesh: host, faceIDs: [1] }], {
    memberIds: ['part'],
    analyzedPartId: 'part',
    resolveTriangles: () => [1],
    createMesh: (_host, _triangles, target) => fakeOverlay(target.key),
  });
  assert.deepEqual(hidden.created, ['fixture:1:0', 'load:0:0']);
  assert.equal(host.children.filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME).length, 2);
});

function quadHost(id) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    10, 0, 0,
    10, 10, 0,
    0, 10, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.parent = { name: 'scene' };
  return { id, active: true, mesh };
}

function arrowGroups(mesh) {
  return (mesh?.children || []).filter((child) => child.name === FEA_FACE_HIGHLIGHT_NAME)
    .flatMap((highlight) => highlight.children.filter((child) => child.name === FEA_LOAD_ARROWS_NAME));
}

function watchDispose(object) {
  let count = 0;
  object.traverse((node) => {
    if (node.geometry?.dispose) {
      const orig = node.geometry.dispose.bind(node.geometry);
      node.geometry.dispose = () => {
        count += 1;
        orig();
      };
    }
    const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
    for (const material of materials) {
      const orig = material.dispose.bind(material);
      material.dispose = () => {
        count += 1;
        orig();
      };
    }
  });
  return () => count;
}

test('load arrows follow direction, stay on that part, and dispose with the highlight', () => {
  const partA = quadHost('a');
  const partB = quadHost('b');
  const face = { part: 'b', n: [0, 0, 1], at: [5, 5, 0], area: 100 };
  const study = {
    fixtures: [{ faces: [{ part: 'a', n: [0, 0, 1] }] }],
    loads: [{
      kind: 'force',
      direction: '-z',
      vector: [0, 0, -8],
      faces: [face],
    }],
  };
  const options = { resolveTriangles: () => [0, 1] };
  const first = syncFeaFaceHighlights(new Map(), study, [partA, partB], options);
  assert.equal(arrowGroups(partA.mesh).length, 0);
  const arrows = arrowGroups(partB.mesh);
  assert.equal(arrows.length, 1);
  const heads = arrows[0].children;
  assert.ok(heads.length >= 3 && heads.length <= 9, `count ${heads.length}`);
  assert.equal(heads[0].name, FEA_LOAD_ARROW_NAME);
  assert.equal(heads[0].parent.parent.parent, partB.mesh);
  for (const head of heads) {
    assert.ok(Math.abs(head.userData.tip[2]) < 1e-6);
    assert.ok(head.userData.tail[2] > head.userData.tip[2]);
    assert.deepEqual(head.userData.dir, [0, 0, -1]);
    assert.equal(head.children[0].material.color.getHex(), FEA_LOAD_HIGHLIGHT_COLOR);
  }
  const disposed = watchDispose(arrows[0]);
  const kept = syncFeaFaceHighlights(first.overlays, study, [partA, partB], options);
  assert.equal(kept.overlays.get('load:0:0').mesh, first.overlays.get('load:0:0').mesh);
  assert.equal(disposed(), 0);

  const sideways = {
    ...study,
    loads: [{ ...study.loads[0], direction: '+x', vector: [8, 0, 0] }],
  };
  const moved = syncFeaFaceHighlights(kept.overlays, sideways, [partA, partB], options);
  assert.ok(disposed() > 0);
  const next = arrowGroups(partB.mesh)[0];
  assert.ok(next);
  assert.deepEqual(next.children[0].userData.dir, [1, 0, 0]);
  assert.notEqual(next, arrows[0]);

  const normal = {
    ...study,
    loads: [{ ...study.loads[0], direction: 'normal', vector: [0, 0, 8] }],
  };
  const flat = syncFeaFaceHighlights(moved.overlays, normal, [partA, partB], options);
  assert.equal(arrowGroups(partB.mesh).length, 0);
  assert.equal(flat.overlays.has('load:0:0'), true);

  const again = syncFeaFaceHighlights(flat.overlays, sideways, [partA, partB], options);
  assert.equal(arrowGroups(partB.mesh).length, 1);
  const hidden = syncFeaFaceHighlights(again.overlays, sideways, [partA, partB], {
    ...options,
    screen: 'results',
  });
  assert.equal(arrowGroups(partB.mesh).length, 0);
  assert.equal(hidden.overlays.has('load:0:0'), true);
  const back = syncFeaFaceHighlights(hidden.overlays, sideways, [partA, partB], {
    ...options,
    screen: 'setup',
  });
  assert.equal(arrowGroups(partB.mesh).length, 1);

  const cleared = syncFeaFaceHighlights(back.overlays, { fixtures: study.fixtures, loads: [] }, [partA, partB], options);
  assert.equal(arrowGroups(partB.mesh).length, 0);
  assert.equal(cleared.overlays.has('load:0:0'), false);
  assert.equal(partA.mesh.children.some((child) => child.name === FEA_FACE_HIGHLIGHT_NAME), true);
});
