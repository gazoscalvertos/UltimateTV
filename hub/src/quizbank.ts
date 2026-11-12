// The family quiz's built-in questions (issue #264): general knowledge, written for this app (nothing
// copied from a quiz book or a trivia site), UK-flavoured and safe for children. Each has a tier,
// 1 for little ones, 2 for the family, 3 for the tricky ones, and exactly three wrong answers that
// are believable but wrong. The game shuffles the four answers, so which colour is right is random.

import type { QuizRoundId } from "@ultimatetv/shared";

export interface BankQuestion {
  round: QuizRoundId;
  tier: 1 | 2 | 3;
  text: string;
  answer: string;
  wrong: [string, string, string];
  fact?: string;
}

type Row = [tier: 1 | 2 | 3, text: string, answer: string, wrong: [string, string, string], fact?: string];

const rows = (round: QuizRoundId, list: Row[]): BankQuestion[] =>
  list.map(([tier, text, answer, wrong, fact]) => ({ round, tier, text, answer, wrong, ...(fact ? { fact } : {}) }));

export const QUIZ_BANK: BankQuestion[] = [
  ...rows("general", [
    [1, "How many days are there in a week?", "7", ["5", "6", "8"]],
    [1, "What colour do you get when you mix blue and yellow paint?", "Green", ["Purple", "Orange", "Brown"]],
    [1, "How many sides does a triangle have?", "3", ["2", "4", "5"]],
    [1, "Which meal do we usually eat first in the day?", "Breakfast", ["Lunch", "Dinner", "Supper"]],
    [1, "How many players are on the pitch for one football team?", "11", ["9", "10", "12"]],
    [2, "What is 12 times 12?", "144", ["124", "132", "148"]],
    [2, "What do you call a word that means the opposite of another word?", "Antonym", ["Synonym", "Acronym", "Homonym"]],
    [2, "How many strings does a standard guitar have?", "6", ["4", "5", "7"]],
    [2, "What does RSVP on an invitation ask you to do?", "Reply", ["Pay", "Arrive early", "Bring a gift"]],
    [2, "Which Roman numeral stands for 50?", "L", ["V", "C", "D"]],
    [3, "What is the smallest prime number?", "2", ["0", "1", "3"], "It is also the only even prime."],
    [3, "Which language has the most native speakers in the world?", "Mandarin Chinese", ["English", "Spanish", "Hindi"]],
    [3, "How many cards are in a standard pack, without jokers?", "52", ["48", "54", "56"]],
  ]),
  ...rows("science", [
    [1, "Which gas do we need to breathe to stay alive?", "Oxygen", ["Carbon dioxide", "Helium", "Nitrogen"]],
    [1, "Which is the closest star to Earth?", "The Sun", ["Polaris", "Sirius", "The Moon"]],
    [1, "How many legs does a spider have?", "8", ["6", "10", "4"]],
    [1, "Which planet is known as the Red Planet?", "Mars", ["Venus", "Jupiter", "Mercury"]],
    [2, "What is the hardest natural material?", "Diamond", ["Gold", "Iron", "Quartz"]],
    [2, "What is the chemical symbol for water?", "H₂O", ["CO₂", "O₂", "NaCl"]],
    [2, "How many bones does an adult human body have?", "206", ["106", "306", "412"], "Babies are born with around 300, and many join together as they grow."],
    [2, "Which planet has the most famous rings?", "Saturn", ["Jupiter", "Mars", "Neptune"]],
    [2, "What force pulls things towards the ground?", "Gravity", ["Magnetism", "Friction", "Static"]],
    [2, "What is the largest organ of the human body?", "Skin", ["Liver", "Heart", "Brain"]],
    [3, "What is the chemical symbol for gold?", "Au", ["Ag", "Gd", "Go"]],
    [3, "What is the part of a cell that releases its energy called?", "Mitochondria", ["Nucleus", "Ribosome", "Membrane"]],
    [3, "About how long does sunlight take to reach the Earth?", "About 8 minutes", ["About 8 seconds", "About 8 hours", "About 8 days"]],
    [3, "Which is the lightest chemical element?", "Hydrogen", ["Helium", "Lithium", "Oxygen"]],
  ]),
  ...rows("geography", [
    [1, "What is the capital of France?", "Paris", ["Lyon", "Marseille", "Nice"]],
    [1, "On which continent is Egypt?", "Africa", ["Asia", "Europe", "South America"]],
    [1, "In which country is the Eiffel Tower?", "France", ["Italy", "Spain", "Germany"]],
    [1, "Which country is shaped like a boot?", "Italy", ["Spain", "Greece", "Portugal"]],
    [2, "What is the capital of Wales?", "Cardiff", ["Swansea", "Newport", "Wrexham"]],
    [2, "Which river flows through London?", "The Thames", ["The Severn", "The Mersey", "The Clyde"]],
    [2, "What is the capital of Australia?", "Canberra", ["Sydney", "Melbourne", "Perth"]],
    [2, "Which is the largest ocean?", "The Pacific", ["The Atlantic", "The Indian", "The Arctic"]],
    [2, "What is the tallest mountain above sea level?", "Mount Everest", ["K2", "Kilimanjaro", "Mont Blanc"]],
    [2, "What is the capital of Japan?", "Tokyo", ["Kyoto", "Osaka", "Seoul"]],
    [3, "What is the capital of Canada?", "Ottawa", ["Toronto", "Vancouver", "Montreal"]],
    [3, "Which is the smallest country in the world?", "Vatican City", ["Monaco", "Malta", "San Marino"]],
    [3, "Which is the largest hot desert?", "The Sahara", ["The Gobi", "The Kalahari", "The Arabian"]],
  ]),
  ...rows("animals", [
    [1, "What sound does a cow make?", "Moo", ["Baa", "Oink", "Neigh"]],
    [1, "What do you call a baby dog?", "A puppy", ["A kitten", "A cub", "A calf"]],
    [1, "Which animal is the tallest?", "Giraffe", ["Elephant", "Camel", "Horse"]],
    [1, "What does a caterpillar turn into?", "A butterfly", ["A beetle", "A bee", "A worm"]],
    [1, "What do pandas mostly eat?", "Bamboo", ["Fish", "Grass", "Berries"]],
    [2, "What is a group of lions called?", "A pride", ["A pack", "A herd", "A flock"]],
    [2, "Which is the fastest land animal?", "Cheetah", ["Lion", "Horse", "Greyhound"]],
    [2, "What is a baby kangaroo called?", "A joey", ["A cub", "A pup", "A calf"]],
    [2, "Which of these birds can't fly?", "Penguin", ["Eagle", "Owl", "Robin"]],
    [2, "What is the largest animal on Earth?", "Blue whale", ["African elephant", "Giraffe", "Great white shark"]],
    [3, "How many hearts does an octopus have?", "3", ["1", "2", "8"]],
    [3, "What is a group of crows called?", "A murder", ["A mob", "A pack", "A parliament"]],
    [3, "Which land animal is pregnant for the longest, about 22 months?", "Elephant", ["Giraffe", "Rhinoceros", "Horse"]],
  ]),
  ...rows("history", [
    [1, "Which ancient people built the pyramids at Giza?", "The Egyptians", ["The Romans", "The Greeks", "The Vikings"]],
    [1, "Who lived in castles and wore armour long ago?", "Knights", ["Astronauts", "Cowboys", "Pirates"]],
    [1, "What did the Vikings sail in?", "Longships", ["Steamships", "Hot air balloons", "Submarines"]],
    [1, "Who was the first person to walk on the Moon?", "Neil Armstrong", ["Buzz Aldrin", "Yuri Gagarin", "John Glenn"]],
    [2, "In which year did the Second World War end?", "1945", ["1918", "1939", "1950"]],
    [2, "Which English king had six wives?", "Henry VIII", ["Henry V", "George III", "Richard III"]],
    [2, "Which ship sank in 1912 after hitting an iceberg?", "The Titanic", ["The Lusitania", "The Mary Rose", "The Endeavour"]],
    [2, "Which city did the Great Fire of 1666 burn down much of?", "London", ["Paris", "York", "Rome"]],
    [2, "Which empire did Julius Caesar belong to?", "The Roman Empire", ["The Ottoman Empire", "The Persian Empire", "The British Empire"]],
    [2, "Who was the first woman to be Prime Minister of the United Kingdom?", "Margaret Thatcher", ["Theresa May", "Queen Victoria", "Golda Meir"]],
    [2, "Which wall came down in 1989?", "The Berlin Wall", ["The Great Wall", "Hadrian's Wall", "The Western Wall"]],
    [3, "Which battle was fought in 1066?", "The Battle of Hastings", ["Waterloo", "Agincourt", "Bosworth"]],
    [3, "In which year did Columbus reach the Americas?", "1492", ["1066", "1666", "1776"]],
    [3, "Which British monarch reigned from 1837 to 1901?", "Queen Victoria", ["Elizabeth I", "Queen Anne", "Mary II"]],
    [3, "Who was the first Roman emperor?", "Augustus", ["Julius Caesar", "Nero", "Caligula"], "Julius Caesar was a dictator, never an emperor."],
  ]),
  ...rows("food", [
    [1, "Which fruit is yellow and curved?", "A banana", ["An apple", "A pear", "An orange"]],
    [1, "What do bees make?", "Honey", ["Jam", "Syrup", "Butter"]],
    [1, "Which vegetable can make you cry when you chop it?", "An onion", ["A carrot", "A potato", "A pea"]],
    [1, "Which country does pizza come from?", "Italy", ["France", "Greece", "Spain"]],
    [2, "What is the main ingredient of guacamole?", "Avocado", ["Tomato", "Pepper", "Cucumber"]],
    [2, "Which of these is not a type of pasta?", "Basmati", ["Penne", "Fusilli", "Linguine"], "Basmati is a rice."],
    [2, "What is sushi traditionally made with?", "Rice", ["Bread", "Pasta", "Potato"]],
    [2, "What is the main ingredient in bread?", "Flour", ["Sugar", "Rice", "Oats"]],
    [2, "Which cheese is traditionally in a Greek salad?", "Feta", ["Cheddar", "Brie", "Edam"]],
    [2, "What is tofu made from?", "Soya beans", ["Rice", "Wheat", "Chickpeas"]],
    [3, "Which spice is the most expensive by weight?", "Saffron", ["Cinnamon", "Paprika", "Black pepper"]],
    [3, "Which nut is used to make marzipan?", "Almond", ["Cashew", "Walnut", "Pecan"]],
    [3, "What is the Granny Smith?", "A type of apple", ["A type of pear", "A type of plum", "A type of grape"]],
  ]),
  ...rows("sport", [
    [1, "In which sport do you score a try?", "Rugby", ["Football", "Tennis", "Cricket"]],
    [1, "What colour card sends a football player off?", "Red", ["Yellow", "Green", "Blue"]],
    [1, "In which sport do you hit a shuttlecock?", "Badminton", ["Tennis", "Squash", "Golf"]],
    [1, "Which sport is played at Wimbledon?", "Tennis", ["Golf", "Cricket", "Rugby"]],
    [2, "How often are the Summer Olympics held?", "Every 4 years", ["Every 2 years", "Every 3 years", "Every 5 years"]],
    [2, "How many holes are in a full round of golf?", "18", ["9", "12", "24"]],
    [2, "How many rings are on the Olympic flag?", "5", ["4", "6", "7"]],
    [2, "Which city hosted the 2012 Summer Olympics?", "London", ["Beijing", "Rio de Janeiro", "Athens"]],
    [2, "In ten-pin bowling, what do you call knocking all the pins down with the first ball?", "A strike", ["A spare", "A split", "A gutter"]],
    [3, "How many players does a rugby union team have on the pitch?", "15", ["11", "13", "9"]],
    [3, "What is the highest score you can get with three darts?", "180", ["150", "200", "170"]],
    [3, "Which country has won the most men's football World Cups?", "Brazil", ["Germany", "Italy", "Argentina"]],
  ]),
  ...rows("entertainment", [
    [1, "In Finding Nemo, what kind of fish is Nemo?", "A clownfish", ["A goldfish", "A shark", "A pufferfish"]],
    [1, "In Frozen, what is the snowman called?", "Olaf", ["Sven", "Kristoff", "Hans"]],
    [1, "Which character lives in a pineapple under the sea?", "SpongeBob SquarePants", ["Patrick Star", "Squidward", "Mr Krabs"]],
    [1, "In The Lion King, which animal is Simba?", "A lion", ["A tiger", "A leopard", "A meerkat"]],
    [1, "Which band had members John, Paul, George and Ringo?", "The Beatles", ["The Rolling Stones", "Queen", "Oasis"]],
    [2, "Who wrote the Harry Potter books?", "J. K. Rowling", ["Roald Dahl", "Enid Blyton", "Julia Donaldson"]],
    [2, "What is the name of the school Harry Potter goes to?", "Hogwarts", ["Beauxbatons", "Durmstrang", "St Brutus's"]],
    [2, "How many keys does a standard piano have?", "88", ["66", "76", "100"]],
    [2, "What is the highest singing voice?", "Soprano", ["Alto", "Tenor", "Bass"]],
    [2, "What is the name of the African kingdom in Black Panther?", "Wakanda", ["Zamunda", "Genovia", "Narnia"]],
    [3, "Who directed Jurassic Park in 1993?", "Steven Spielberg", ["James Cameron", "George Lucas", "Ridley Scott"]],
    [3, "In which year did the first Star Wars film come out?", "1977", ["1975", "1980", "1983"]],
    [3, "Who composed The Four Seasons?", "Vivaldi", ["Mozart", "Bach", "Beethoven"]],
  ]),
];
