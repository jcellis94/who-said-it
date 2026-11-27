/* Topic packs. Every topic here is original to this project; do not copy
   cards from any published game. To add a pack, add a key with a label and a
   list; the host's pack picker fills itself from this file. */

export var PACKS = {
  general: {
    label: "General",
    topics: [
      "Things you shouldn't teach a parrot to say.",
      "Things that would be worse if they were twice as big.",
      "Things a dog thinks about all day.",
      "Things you'd find in a wizard's junk drawer.",
      "Things that should come with a warning label.",
      "Things you shouldn't do in an elevator.",
      "Things you'd buy first after winning the lottery.",
      "Things that sound like a superpower but would be useless.",
      "Things your phone would say about you.",
      "Things you'd find under this couch.",
      "Things you shouldn't yell in a library.",
      "Things that could ruin a family photo.",
      "Things that are harder than they look.",
      "Things you'd put in a time capsule.",
      "Things a baby would say if babies could talk.",
      "Things you shouldn't pack for a camping trip.",
      "Things that would make school more fun.",
      "Things you do when nobody is watching.",
      "Things you pretend to like to be polite.",
      "Things you'd ask a talking cat.",
      "Things that would be a bad name for a boat.",
      "Things you shouldn't say on your first day at a new job.",
      "Things aliens would find strange about Earth.",
      "Things you'd never lend to a neighbor.",
      "Things that make a road trip feel longer.",
      "Things you shouldn't try on roller skates.",
      "Things you'd rename if you were in charge.",
      "Things that belong in a museum about this family.",
      "Things that smell better than they taste.",
      "Things you wish came with an undo button.",
      "Things you'd say to your ten-year-old self.",
      "Things you shouldn't say to your dentist.",
      "Things a cat is plotting right now.",
      "Things you'd do with one extra hour every day.",
      "Things that should never be sold in a vending machine.",
      "Things you'd shout if you found a dinosaur in the yard.",
      "Things that would make a terrible ice cream flavor.",
      "Things a pirate would complain about at the office.",
      "Things you say to a stubbed toe.",
      "Things you'd wish for if wishes had to rhyme.",
      "Things that would be a terrible name for a pet goldfish.",
      "Things a robot would get wrong about birthdays.",
      "Things you shouldn't keep in your pockets.",
      "Things you'd teach if you ran a class for one day.",
      "Things that get lost in every house.",
      "Things you'd do first as mayor of this town.",
      "Things that make a Monday worse.",
      "Things a ghost would find annoying about this house.",
      "Things you'd bring to a desert island and regret.",
      "Things that would be better with wheels."
    ]
  },
  thanksgiving: {
    label: "Thanksgiving",
    topics: [
      "Things you shouldn't say while carving the turkey.",
      "Things that would make a terrible pie filling.",
      "Things you'd rather do than wash the dishes tonight.",
      "Things the turkey was thinking this morning.",
      "Things you shouldn't bring to Thanksgiving dinner.",
      "Things you're secretly thankful for.",
      "Things that get said at the kids' table.",
      "Things you shouldn't do with leftover mashed potatoes.",
      "Things a pilgrim would find confusing about this dinner.",
      "Things you shouldn't say when someone asks for the recipe.",
      "Things that make you fall asleep after dinner.",
      "Things that would improve the Thanksgiving parade.",
      "Things you shouldn't put gravy on.",
      "Things this family argues about every year.",
      "Things Grandma would never allow at the table.",
      "Things you'd say to get out of the long drive home.",
      "Things that should be a Thanksgiving tradition.",
      "Things you shouldn't whisper during a toast.",
      "Things you'd hide the last slice of pie behind.",
      "Things that happen when the adults leave the kitchen.",
      "Things a football announcer would say about this dinner.",
      "Things you'd do with a fifty-pound turkey.",
      "Things you shouldn't say to the cook.",
      "Things you'd trade your dessert for.",
      "Things you'd name a brand-new side dish.",
      "Things you'll remember about today."
    ]
  },
  christmas: {
    label: "Christmas",
    topics: [
      "Things you shouldn't leave out for Santa.",
      "Things an elf would complain about on the job.",
      "Things that would make a terrible stocking stuffer.",
      "Things a reindeer does in the off-season.",
      "Things you shouldn't say when you open a gift.",
      "Things that always go missing during the holidays.",
      "Things a snowman worries about.",
      "Things you'd find on the naughty list.",
      "Things that would ruin a carol.",
      "Things you shouldn't hang on the tree.",
      "Things Santa says when he gets stuck in a chimney.",
      "Things you'd regift without a second thought.",
      "Things that should never be wrapped.",
      "Things you'd add to a gingerbread house.",
      "Things the dog thinks about the tree.",
      "Things you shouldn't write in a holiday card.",
      "Things that happen after the kids go to bed on Christmas Eve.",
      "Things you'd ask for if Santa took requests by text.",
      "Things that make an ugly sweater uglier.",
      "Things you'd say to get out of taking down the lights.",
      "Things a fruitcake could be used for.",
      "Things you'll remember about this Christmas."
    ]
  }
};

/* A topic this game has not played yet from its pack; starts over when the
   pack runs out. Returns { topic, index }. */
export function pickTopic(pack, used, rand) {
  var list = (PACKS[pack] || PACKS.general).topics, left = [];
  for (var i = 0; i < list.length; i++) if ((used || []).indexOf(i) < 0) left.push(i);
  if (!left.length) for (var k = 0; k < list.length; k++) left.push(k);
  var index = left[Math.floor((rand || Math.random)() * left.length)];
  return { topic: list[index], index: index };
}
