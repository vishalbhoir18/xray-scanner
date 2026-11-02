// Everything the app says about each bone.
//   name    – shown on the card and in the quiz
//   group   – which colour family it belongs to
//   meaning – what the name means
//   text    – the fun fact shown when you tap it
//   clue    – quiz hint: says where to look without giving away the name

export const GROUPS = {
  forearm:    { label: 'Forearm bone', color: '#7ee08a' },
  carpal:     { label: 'Carpal (wrist bone)', color: '#ffb547' },
  metacarpal: { label: 'Metacarpal (palm bone)', color: '#4fd1ff' },
  phalanx:    { label: 'Phalanx (finger bone)', color: '#c39bff' },
  skull:      { label: 'Skull', color: '#ffd9a0' },
  spine:      { label: 'Spine', color: '#ff9d9d' },
  chest:      { label: 'Chest and shoulder', color: '#4fd1ff' },
  arm:        { label: 'Arm', color: '#7ee08a' },
  pelvis:     { label: 'Pelvis', color: '#ffb547' },
  leg:        { label: 'Leg and foot', color: '#c39bff' },
};

export const BONE_INFO = {
  // ----- Forearm -----
  radius: {
    name: 'Radius', group: 'forearm', meaning: 'Latin for "spoke of a wheel"',
    text: 'The forearm bone on your thumb side. It rolls around the ulna when you turn your palm up and down. Its wrist end is the spot most often broken when people fall onto an outstretched hand.',
    clue: 'A long forearm bone on the thumb side.',
  },
  ulna: {
    name: 'Ulna', group: 'forearm', meaning: 'Latin for "elbow"',
    text: 'The forearm bone on your little-finger side. The bump you can feel on the back of your wrist is one end of it, and the point of your elbow is the other.',
    clue: 'A long forearm bone on the little-finger side.',
  },

  // ----- Wrist -----
  scaphoid: {
    name: 'Scaphoid', group: 'carpal', meaning: 'Greek for "boat-shaped"',
    text: 'The most commonly broken wrist bone. Its blood supply is poor, so a scaphoid break can heal slowly and is sometimes missed on a first X-ray.',
    clue: 'Wrist bone next to the forearm, on the thumb side.',
  },
  lunate: {
    name: 'Lunate', group: 'carpal', meaning: 'Latin for "moon-shaped"',
    text: 'A crescent-shaped bone in the middle of the wrist. It is the wrist bone that most often slips out of place (dislocates).',
    clue: 'Wrist bone next to the forearm, in the middle.',
  },
  triquetrum: {
    name: 'Triquetrum', group: 'carpal', meaning: 'Latin for "three-cornered"',
    text: 'A pyramid-shaped bone on the little-finger side of the wrist, sitting next to the lunate.',
    clue: 'Wrist bone next to the forearm, towards the little finger.',
  },
  pisiform: {
    name: 'Pisiform', group: 'carpal', meaning: 'Latin for "pea-shaped"',
    text: 'The smallest wrist bone. It sits inside a tendon, and you can feel it as the hard little bump at the base of your palm on the little-finger side.',
    clue: 'The tiniest wrist bone, on the little-finger edge.',
  },
  trapezium: {
    name: 'Trapezium', group: 'carpal', meaning: 'Greek for "little table"',
    text: 'Forms a saddle-shaped joint with the thumb. This joint is what lets your thumb swing across to touch every fingertip.',
    clue: 'The wrist bone right at the base of the thumb.',
  },
  trapezoid: {
    name: 'Trapezoid', group: 'carpal', meaning: 'Greek for "table-like"',
    text: 'A small wedge-shaped bone that locks the index-finger metacarpal firmly in place.',
    clue: 'The wrist bone under your index finger\'s palm bone.',
  },
  capitate: {
    name: 'Capitate', group: 'carpal', meaning: 'Latin for "head-shaped"',
    text: 'The largest wrist bone, right in the centre of your wrist. It is usually the first wrist bone to turn from cartilage into bone in a baby.',
    clue: 'The biggest wrist bone, under your middle finger\'s palm bone.',
  },
  hamate: {
    name: 'Hamate', group: 'carpal', meaning: 'Latin for "hooked"',
    text: 'Has a small hook on its palm side. Golfers, tennis and baseball players sometimes break this hook when a club, racket or bat strikes it.',
    clue: 'The wrist bone under your ring and little fingers\' palm bones.',
  },

  // ----- Palm -----
  mc1: {
    name: '1st metacarpal', group: 'metacarpal', meaning: 'Palm bone of the thumb',
    text: 'The shortest and thickest palm bone, and the most mobile one. It lets the thumb oppose the fingers, which is key to gripping.',
    clue: 'The palm bone that leads to your thumb.',
  },
  mc2: {
    name: '2nd metacarpal', group: 'metacarpal', meaning: 'Palm bone of the index finger',
    text: 'The longest palm bone. It barely moves, acting as a stiff pillar the rest of the hand works around.',
    clue: 'The palm bone that leads to your index finger.',
  },
  mc3: {
    name: '3rd metacarpal', group: 'metacarpal', meaning: 'Palm bone of the middle finger',
    text: 'The only metacarpal with a small pointed bump (the styloid process) at its base. Together with the 2nd, it forms the stable centre of the hand.',
    clue: 'The palm bone that leads to your middle finger.',
  },
  mc4: {
    name: '4th metacarpal', group: 'metacarpal', meaning: 'Palm bone of the ring finger',
    text: 'Thinner and more mobile than the 2nd and 3rd. It moves slightly to help your palm cup around objects.',
    clue: 'The palm bone that leads to your ring finger.',
  },
  mc5: {
    name: '5th metacarpal', group: 'metacarpal', meaning: 'Palm bone of the little finger',
    text: 'The most mobile of the four finger metacarpals. A break near its knuckle is called a "boxer\'s fracture" because punching a hard object often causes it.',
    clue: 'The palm bone that leads to your little finger.',
  },

  // ----- Skull -----
  frontal: {
    name: 'Frontal bone', group: 'skull', meaning: 'The bone at the front of the head',
    text: 'Your forehead. It also forms the roof of each eye socket. Babies are born with two halves that normally join in the first years of life.',
    clue: 'Touch your forehead.',
  },
  parietal: {
    name: 'Parietal bones', group: 'skull', meaning: 'Latin for "walls"',
    text: 'A pair of curved plates that form the roof and upper sides of your skull, like the walls of a room around your brain.',
    clue: 'The very top of your head.',
  },
  temporal: {
    name: 'Temporal bones', group: 'skull', meaning: 'Latin for "time", maybe because grey hair often starts here',
    text: 'One on each side, around your ears. Deep inside them sit the three smallest bones in your body: the tiny ossicles that help you hear.',
    clue: 'The sides of your head, by your ears and temples.',
  },
  zygomatic: {
    name: 'Zygomatic bones', group: 'skull', meaning: 'Greek for "yoke" or "bridge"',
    text: 'Your cheekbones. They shape your face and protect the eye sockets from below, and strong chewing muscles attach beneath them.',
    clue: 'Your cheekbones, just below the outer corner of each eye.',
  },
  nasal: {
    name: 'Nasal bones', group: 'skull', meaning: 'Latin for "nose"',
    text: 'Only the top bridge of your nose is bone, and it is just two small plates. The rest, including the tip, is flexible cartilage, which is why a skull has a hole there.',
    clue: 'The hard bridge at the top of your nose.',
  },
  maxilla: {
    name: 'Maxilla', group: 'skull', meaning: 'Latin for "upper jaw"',
    text: 'Your upper jawbone. It holds your top teeth and also forms part of the roof of your mouth and the floor of each eye socket.',
    clue: 'The bone that holds your top teeth.',
  },
  teeth: {
    name: 'Teeth', group: 'skull', meaning: 'Not actually bones',
    text: 'A surprise: teeth are not bones! Their outer enamel is the hardest substance in your body, but unlike bone, enamel cannot repair itself.',
    clue: 'You use them to bite.',
  },
  mandible: {
    name: 'Mandible', group: 'skull', meaning: 'Latin for "to chew"',
    text: 'Your lower jaw, and the only skull bone that moves freely. It is also the largest and strongest bone in your face.',
    clue: 'The part of your skull that moves when you talk.',
  },
  occipital: {
    name: 'Occipital bone', group: 'skull', meaning: 'Latin for "back of the head"',
    text: 'Forms the back and base of your skull. It has a big opening, the foramen magnum, where your brain connects to your spinal cord.',
    clue: 'The back of your head, just above your neck.',
  },
  sphenoid: {
    name: 'Sphenoid bone', group: 'skull', meaning: 'Greek for "wedge-shaped"',
    text: 'Shaped like a butterfly, it sits behind your eyes in the middle of your skull and touches every other bone of the brain case.',
    clue: 'A butterfly-shaped bone. Look deep in the eye sockets and at the temples.',
  },
  ethmoid: {
    name: 'Ethmoid bone', group: 'skull', meaning: 'Greek for "sieve-like"',
    text: 'A light, spongy bone between your eyes. Tiny holes in its roof let the nerves for smell pass from your nose up to your brain.',
    clue: 'A delicate bone between your eye sockets, deep behind the nose.',
  },
  lacrimal: {
    name: 'Lacrimal bones', group: 'skull', meaning: 'Latin for "tear"',
    text: 'The smallest bones in your face, as thin as a fingernail. Each has a groove that channels tears from your eye down into your nose, which is why your nose runs when you cry.',
    clue: 'Tiny bones at the inner corner of each eye socket.',
  },
  palatine: {
    name: 'Palatine bones', group: 'skull', meaning: 'Latin for "palate"',
    text: 'Two L-shaped bones that form the back part of the roof of your mouth.',
    clue: 'The back of the roof of your mouth.',
  },
  concha: {
    name: 'Inferior nasal conchae', group: 'skull', meaning: 'Latin for "shell"',
    text: 'Curled like little scrolls on the walls of your nose. They swirl the air you breathe in so it gets warmed and moistened on the way to your lungs.',
    clue: 'Curled bones inside the nose opening.',
  },
  vomer: {
    name: 'Vomer', group: 'skull', meaning: 'Latin for "ploughshare"',
    text: 'A thin flat bone shaped like the blade of a plough. It forms the lower part of the wall that divides your nose into left and right.',
    clue: 'The thin bony wall in the middle of the nose opening.',
  },
  hyoid: {
    name: 'Hyoid bone', group: 'skull', meaning: 'Greek for "U-shaped"',
    text: 'The only bone in your body that touches no other bone! It hangs in your neck from muscles and ligaments, and helps you swallow and speak.',
    clue: 'A small U-shaped bone in your neck, just under your jaw.',
  },
  skull: {
    name: 'Skull', group: 'skull', meaning: 'Also called the cranium when talking about the brain case',
    text: 'Made of 22 bones that lock together like a jigsaw, with only the lower jaw free to move. Babies have soft gaps between the plates so the head can grow. Try Skull mode to meet them by name.',
    clue: 'It protects your brain.',
  },

  // ----- Spine -----
  cervical: {
    name: 'Cervical vertebrae', group: 'spine', meaning: 'Latin for "neck"',
    text: 'The 7 bones of your neck. Almost every mammal has exactly seven neck bones, even a giraffe! Theirs are just far longer.',
    clue: 'The bones in your neck.',
  },
  thoracic: {
    name: 'Thoracic vertebrae', group: 'spine', meaning: 'Greek for "chest"',
    text: 'The 12 bones of your upper and middle back. Each one connects to a pair of ribs, which is why this part of your back bends the least.',
    clue: 'The part of the spine behind your ribs.',
  },
  lumbar: {
    name: 'Lumbar vertebrae', group: 'spine', meaning: 'Latin for "loin"',
    text: 'The 5 biggest vertebrae in your spine, in your lower back. They carry most of the weight of your upper body, which is why lower backs get sore.',
    clue: 'The part of the spine in your lower back.',
  },
  sacrum: {
    name: 'Sacrum', group: 'spine', meaning: 'Latin for "sacred bone"',
    text: 'Five vertebrae that fuse into one solid wedge in early adulthood, locking your spine into your pelvis. Your tailbone hangs just below it, though this 3D model does not include one.',
    clue: 'The bottom end of your spine, at the back of the pelvis.',
  },

  // ----- Chest and shoulder -----
  clavicle: {
    name: 'Clavicle', group: 'chest', meaning: 'Latin for "little key"',
    text: 'Your collarbone. It is one of the most often broken bones, and the first long bone to start forming before birth, yet among the last to finish growing.',
    clue: 'The bone you can feel running from your neck to your shoulder.',
  },
  scapula: {
    name: 'Scapula', group: 'chest', meaning: 'Latin for "shoulder"',
    text: 'Your shoulder blade. It connects to the rest of your skeleton only through the collarbone, and otherwise floats on layers of muscle, which gives your arm its huge range of motion.',
    clue: 'A flat triangle on your upper back.',
  },
  sternum: {
    name: 'Sternum', group: 'chest', meaning: 'Greek for "chest"',
    text: 'Your breastbone, shaped a bit like a dagger. Its small tip is called the xiphoid process, from the Greek for "sword-shaped".',
    clue: 'The flat bone down the middle of your chest.',
  },
  ribsTrue: {
    name: 'True ribs', group: 'chest', meaning: 'Ribs 1 to 7',
    text: 'The top 7 pairs. Each one has its own strip of cartilage joining directly to the breastbone. That cartilage lets your chest expand with every breath.',
    clue: 'The upper ribs, which reach all the way to your breastbone.',
  },
  ribsFalse: {
    name: 'False ribs', group: 'chest', meaning: 'Ribs 8 to 10',
    text: 'These 3 pairs do not reach the breastbone on their own. Instead they hitch a ride, joining the cartilage of the rib above.',
    clue: 'The lower ribs, which join the rib above instead of the breastbone.',
  },
  ribsFloating: {
    name: 'Floating ribs', group: 'chest', meaning: 'Ribs 11 and 12',
    text: 'The 2 lowest pairs attach to your spine at the back but stop short at the front, with nothing holding their front ends to the skeleton.',
    clue: 'The two shortest pairs at the bottom of your ribcage.',
  },

  costalCartilage: {
    name: 'Costal cartilage', group: 'chest', meaning: 'Costal = to do with the ribs',
    text: 'Not bone at all: these bendy strips join your ribs to your breastbone, so your chest can spring open every time you breathe in. They tend to harden with age.',
    clue: 'The pale, bendy strips that join your ribs to your breastbone.',
  },

  // ----- Arm -----
  humerus: {
    name: 'Humerus', group: 'arm', meaning: 'Latin for "shoulder"',
    text: 'Your upper arm bone. When you hit your "funny bone", you are really bumping the ulnar nerve where it runs past the end of the humerus at your elbow.',
    clue: 'The single long bone in your upper arm.',
  },
  handBones: {
    name: 'Hand bones', group: 'arm', meaning: '27 bones in each hand',
    text: 'Your two hands hold 54 bones, about a quarter of your whole skeleton. Try Hand mode to meet each one by name.',
    clue: 'At the end of your arm.',
  },

  // ----- Pelvis -----
  hipBone: {
    name: 'Hip bone', group: 'pelvis', meaning: 'Also called the coxal bone',
    text: 'Each side starts as three separate bones (ilium, ischium and pubis) that fuse together in your teens. When you sit down, you are resting on the ischium.',
    clue: 'The large wing-shaped bones that your legs connect to.',
  },

  // ----- Leg -----
  femur: {
    name: 'Femur', group: 'leg', meaning: 'Latin for "thigh"',
    text: 'Your thigh bone: the longest and strongest bone in your body, roughly a quarter of your height.',
    clue: 'The single long bone in your thigh.',
  },
  patella: {
    name: 'Patella', group: 'leg', meaning: 'Latin for "little plate"',
    text: 'Your kneecap, the largest bone that grows inside a tendon. Babies are born with a kneecap of soft cartilage, and it only turns to bone after a few years.',
    clue: 'The small round bone at the front of your knee.',
  },
  tibia: {
    name: 'Tibia', group: 'leg', meaning: 'Latin for "shin", and also "flute"',
    text: 'Your shinbone and the second longest bone in your body. It carries most of your weight down to your foot.',
    clue: 'The thick bone in your shin.',
  },
  fibula: {
    name: 'Fibula', group: 'leg', meaning: 'Latin for "clasp" or "brooch"',
    text: 'The thin bone beside your shin. It carries little weight and mainly anchors muscles, so surgeons sometimes borrow a piece of it to repair other bones.',
    clue: 'The thin bone on the outer side of your lower leg.',
  },
  footBones: {
    name: 'Foot bones', group: 'leg', meaning: '26 bones in each foot',
    text: 'Your hands and feet together hold 106 bones, more than half of the 206 in your whole body!',
    clue: 'The bones you stand on.',
  },
};

const FINGER_NAMES = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'];

for (let f = 0; f < 5; f++) {
  const finger = FINGER_NAMES[f];
  const n = f + 1;
  BONE_INFO['pp' + n] = {
    name: `Proximal phalanx (${finger})`, group: 'phalanx', meaning: 'Proximal = nearest the body',
    text: f === 0
      ? 'The thumb has only two phalanges, not three. That is why it has one fewer bending joint than your other fingers.'
      : 'The longest bone of each finger. It runs from your knuckle to the first finger joint.',
    clue: `The ${finger} bone that starts at the knuckle.`,
  };
  BONE_INFO['dp' + n] = {
    name: `Distal phalanx (${finger})`, group: 'phalanx', meaning: 'Distal = farthest from the body',
    text: 'The fingertip bone. It ends in a flat, rough tuft that supports the soft pad of your fingertip and your nail.',
    clue: `The very tip of your ${finger}.`,
  };
  if (f > 0) {
    BONE_INFO['mp' + n] = {
      name: `Middle phalanx (${finger})`, group: 'phalanx', meaning: 'The middle finger bone',
      text: 'Sits between the two finger joints. Fingers have three phalanges each, but the thumb has no middle one.',
      clue: `The bone between the two bending joints of your ${finger}.`,
    };
  }
}
